#!/usr/bin/env bash
# Atualiza os quatro repositórios do workspace Pontalti no Ubuntu.
set -Eeuo pipefail

fail() {
  printf '\nErro: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'HELP'
Uso: bash update-all.sh [--git-only] [--restart] [--https]

Atualiza documentação, API, painel e loja. Repositórios ausentes são criados
na pasta pai da API, lado a lado; o nome local da loja é marketplace-frontend.
Pode ser chamado de qualquer diretório. Execute com o usuário dos aplicativos.

  --git-only  Apenas atualiza/clona os repositórios, sem instalar nem compilar.
  --restart   Após TODOS os builds, reinicia os processos PM2 que já estavam
              online e cujo cwd é uma das três pastas dos aplicativos.
              Inclui o worker WhatsApp se estiver online na pasta da loja.
  --https     Usa HTTPS em clones e atualizações, inclusive em origins SSH,
              sem alterar as URLs configuradas nos repositórios.
  --help      Mostra esta ajuda.

Pré-requisitos: Bash, Git, Node.js >= 22 e npm; PM2 para --restart.
O acesso Git precisa incluir os repositórios privados pontalti e
pontalti-marketplace. --git-only dispensa Node.js, npm e PM2.
Para HTTPS com repositórios privados, autentique antes com:
  gh auth login --hostname github.com --git-protocol https --web
  gh auth setup-git

O painel usa Yarn 1.22.22 pelo npm exec; API e loja usam npm ci.
Arquivos .env e certificados devem ser configurados separadamente, sobretudo
após um primeiro clone. Nenhum segredo é copiado entre os aplicativos.
O script gera o Prisma Client, mas NÃO executa migrations, db push, reset,
setup.sh, seeds ou Docker Compose. Confira as migrations pendentes antes de
usar --restart. Nenhum processo PM2 novo é criado ou ativado.

Alterações locais, commits locais não publicados, branches diferentes das
esperadas e pastas ocupadas sem Git interrompem a atualização.
Se a pasta pai ainda não tem Git, inicializa nela o repositório de documentação;
arquivos existentes em conflito impedem o checkout e devem ser conciliados.
Se os aplicativos estão diretamente na pasta pessoal, clona a documentação
em ~/pontalti, mantendo o Git da documentação fora da raiz da pasta pessoal.

Exemplos:
  bash update-all.sh --git-only
  bash update-all.sh
  bash update-all.sh --restart
HELP
}

repository_url() {
  if [[ "$use_https" == true ]]; then
    printf 'https://github.com/fabianobarrosrocha/%s.git' "$1"
  else
    printf 'git@github.com:fabianobarrosrocha/%s.git' "$1"
  fi
}

remote_git() {
  local status=0

  if [[ "$use_https" == true ]]; then
    git -c 'url.https://github.com/.insteadOf=git@github.com:' \
      -c 'url.https://github.com/.insteadOf=ssh://git@github.com/' "$@" || status=$?
  else
    git "$@" || status=$?
  fi

  if [[ "$status" -ne 0 ]]; then
    printf '\nFalha no acesso Git. Se aparecer "Permission denied (publickey)", configure a chave SSH ou use --https.\n' >&2
    printf 'Para HTTPS, autentique uma conta com acesso aos repositórios privados:\n' >&2
    printf '  gh auth login --hostname github.com --git-protocol https --web\n  gh auth setup-git\n' >&2
  fi
  return "$status"
}

check_repository() {
  local directory="$1" repository="$2" branch="$3" current_branch origin_name

  if [[ ! -e "$directory/.git" ]]; then
    if [[ "$directory" != "$workspace_dir" && -e "$directory" ]]; then
      fail "$directory existe, mas não é um repositório. Preserve ou mova essa pasta antes de continuar."
    fi
    if git -C "$workspace_dir" rev-parse --show-toplevel >/dev/null 2>&1 &&
      [[ ! -e "$workspace_dir/.git" ]]; then
      fail "A pasta pai pertence a outro repositório Git. Use um workspace Pontalti independente."
    fi
    return
  fi

  [[ "$(cd -- "$(git -C "$directory" rev-parse --show-toplevel)" && pwd -P)" == "$directory" ]] ||
    fail "Raiz Git inesperada em $directory."
  if [[ -n "$(git -C "$directory" status --porcelain --untracked-files=normal)" ]]; then
    printf '\nArquivos com alterações em %s:\n' "$directory" >&2
    git -C "$directory" status --short --untracked-files=normal >&2
    printf 'Para conferir o resumo: git -C %q diff --stat\n' "$directory" >&2
    fail "Há alterações locais em $directory. Faça commit ou preserve-as antes de atualizar."
  fi

  current_branch="$(git -C "$directory" symbolic-ref --quiet --short HEAD || true)"
  [[ "$current_branch" == "$branch" ]] ||
    fail "$directory está na branch '$current_branch'; a atualização espera '$branch'."
  git -C "$directory" rev-parse --verify HEAD >/dev/null 2>&1 ||
    fail "$directory ainda não tem um checkout válido. Conclua a configuração Git primeiro."
  origin_name="$(git -C "$directory" remote get-url origin)"
  origin_name="${origin_name##*/}"
  [[ "${origin_name%.git}" == "$repository" ]] ||
    fail "O origin de $directory não corresponde ao repositório $repository."
}

fetch_repository() {
  local directory="$1" repository="$2" branch="$3"

  if [[ -e "$directory/.git" ]]; then
    remote_git -C "$directory" fetch origin "$branch"
    git -C "$directory" merge-base --is-ancestor HEAD FETCH_HEAD ||
      fail "$directory tem commits locais ou histórico divergente. Concilie com origin/$branch primeiro."
    fetched_commits+=("$(git -C "$directory" rev-parse FETCH_HEAD)")
  else
    remote_git ls-remote --exit-code "$(repository_url "$repository")" "refs/heads/$branch" >/dev/null
    fetched_commits+=("")
  fi
}

update_repository() {
  local directory="$1" repository="$2" branch="$3" commit="$4"

  printf '\n==> Repositório: %s (%s)\n' "$repository" "$branch"
  if [[ -e "$directory/.git" ]]; then
    git -C "$directory" merge --ff-only "$commit"
  elif [[ "$directory" == "$workspace_dir" ]]; then
    # O workspace já contém a API: cria o Git da documentação nessa mesma raiz.
    git init "$workspace_dir"
    git -C "$workspace_dir" symbolic-ref HEAD "refs/heads/$branch"
    git -C "$workspace_dir" remote add origin "$(repository_url "$repository")"
    remote_git -C "$workspace_dir" fetch origin "$branch"
    git -C "$workspace_dir" checkout -b "$branch" --track "origin/$branch"
  else
    # O cd .. em main já nos deixou na pasta pai da API.
    remote_git clone --branch "$branch" --single-branch "$(repository_url "$repository")" "${directory##*/}"
  fi
}

install_and_build() (
  local directory="$1"
  cd -- "$directory"
  printf '\n==> Dependências e build: %s\n' "${directory##*/}"

  if [[ "${directory##*/}" == factory-control ]]; then
    # O lockfile versionado do painel é yarn.lock (não o package-lock local).
    npm exec --yes --package=yarn@1.22.22 -- yarn install --frozen-lockfile --non-interactive --production=false
  else
    npm ci --include=dev --no-audit --no-fund
  fi

  if [[ "${directory##*/}" == pontalti-core-api ]]; then
    ./node_modules/.bin/prisma generate
  fi
  npm run build
)

main() {
  local git_only=false restart=false use_https=false option script_dir workspace_dir documentation_dir user_home_dir
  local index directory node_version pm2_ids=""
  local -a directories repositories branches fetched_commits=()

  for option in "$@"; do
    case "$option" in
      --git-only) git_only=true ;;
      --restart) restart=true ;;
      --https) use_https=true ;;
      --help|-h) usage; return ;;
      *) fail "Opção desconhecida: $option. Use --help." ;;
    esac
  done
  [[ "$git_only" != true || "$restart" != true ]] ||
    fail "--git-only e --restart não podem ser usados juntos."

  command -v git >/dev/null || fail "Instale Git no Ubuntu antes de executar este script."
  if [[ "$git_only" != true ]]; then
    command -v node >/dev/null || fail "Instale Node.js >= 22 e npm."
    command -v npm >/dev/null || fail "npm não encontrado."
    node_version="$(node -p 'process.versions.node')"
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
      fail "Node.js $node_version não atende ao mínimo 22 exigido pelas dependências do painel."
  fi

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  [[ "${script_dir##*/}" == pontalti-core-api ]] || fail "Mantenha este script na raiz de pontalti-core-api."
  cd -- "$script_dir"
  cd ..
  workspace_dir="$(pwd -P)"
  user_home_dir="$(cd -- "$HOME" && pwd -P)"
  documentation_dir="$workspace_dir"
  if [[ "$workspace_dir" == "$user_home_dir" ]]; then
    documentation_dir="$workspace_dir/pontalti"
  fi
  directories=("$documentation_dir" "$workspace_dir/pontalti-core-api" "$workspace_dir/factory-control" "$workspace_dir/marketplace-frontend")
  repositories=(pontalti pontalti-core-api factory-control pontalti-marketplace)
  branches=(main master master main)
  printf 'Workspace: %s\n' "$workspace_dir"

  # Valida TODOS os checkouts antes de modificar qualquer arquivo versionado.
  for index in "${!directories[@]}"; do
    check_repository "${directories[$index]}" "${repositories[$index]}" "${branches[$index]}"
  done

  if [[ "$restart" == true ]]; then
    command -v pm2 >/dev/null || fail "PM2 não encontrado. Execute sem --restart ou configure o PM2."
    # O JSON inclui o ambiente dos processos: encaminha direto ao Node sem exibi-lo.
    pm2_ids="$(pm2 jlist | node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const apps = new Set(process.argv.slice(1).map((cwd) => {
        try { return fs.realpathSync(cwd); }
        catch { return path.resolve(cwd); }
      }));
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const processes = JSON.parse(input);
        const ids = processes.filter((entry) => {
          if (entry.pm2_env?.status !== "online" || !entry.pm2_env.pm_cwd) return false;
          try { return apps.has(fs.realpathSync(entry.pm2_env.pm_cwd)); }
          catch { return false; }
        }).map((entry) => entry.pm_id);
        process.stdout.write(ids.join(" "));
      });
    ' "${directories[@]:1}")"
    [[ -n "$pm2_ids" ]] || fail "Não há processos PM2 online nas pastas dos aplicativos. Execute sem --restart."
  fi

  # Falhas de acesso e divergências são detectadas antes de atualizar os checkouts.
  for index in "${!directories[@]}"; do
    fetch_repository "${directories[$index]}" "${repositories[$index]}" "${branches[$index]}"
  done
  for index in "${!directories[@]}"; do
    update_repository "${directories[$index]}" "${repositories[$index]}" "${branches[$index]}" "${fetched_commits[$index]}"
  done

  if [[ "$git_only" == true ]]; then
    printf '\nRepositórios atualizados. Configure os ambientes dos novos aplicativos antes dos builds.\n'
    return
  fi

  for directory in "${directories[@]:1}"; do
    if [[ ! -f "$directory/.env" && ! -f "$directory/.env.local" &&
      ! -f "$directory/.env.production" && ! -f "$directory/.env.production.local" ]]; then
      printf '\nAtenção: %s não tem arquivo .env. Configure-o ou forneça o ambiente externamente antes de usar o aplicativo.\n' "$directory"
    fi
    install_and_build "$directory"
  done

  printf '\nBuilds concluídos. Confira as migrations SQL pendentes da API e do Supabase.\n'
  if [[ "$restart" == true ]]; then
    local -a process_ids
    read -r -a process_ids <<< "$pm2_ids"
    pm2 restart "${process_ids[@]}"
    printf '\nProcessos PM2 reiniciados, mantendo o ambiente já configurado.\n'
  else
    printf 'Processos em execução não foram reiniciados. Use --restart para reiniciar pelo PM2.\n'
  fi
}

trap 'printf "\nAtualização interrompida na linha %s. Corrija o erro acima antes de tentar novamente.\n" "$LINENO" >&2' ERR
# Todas as funções já estão na memória quando o Git atualiza este próprio arquivo.
main "$@"; exit
