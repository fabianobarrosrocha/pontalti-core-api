import { PrismaClient } from "@prisma/client"
import userService from "@pontalti/modules/v1/auth/auth-service";
import bcrypt from 'bcrypt'

const dbClient = new PrismaClient();

async function main() {
  // Funções auxiliares
  function getRandomNumber(min: number, max: number) {
    return Number((Math.random() * (max - min) + min).toFixed(2));
  }

  function getRandomDate(start: Date, end: Date) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  function getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  // Limpar dados existentes (opcional - remover se quiser manter dados)
  console.log("🧹 Limpando dados existentes...");
  
  // Limpar relacionamentos primeiro (ordem inversa da criação, respeitando foreign keys)
  
  // 1. Tabelas de relacionamento N:N e dependentes de Orders
  await dbClient.expenseOrders.deleteMany();
  await dbClient.labelPrints.deleteMany();
  await dbClient.materialConsumption.deleteMany();
  await dbClient.productionControl.deleteMany();
  await dbClient.delivery.deleteMany();
  await dbClient.deliveryPackaging.deleteMany();
  await dbClient.payments.deleteMany();
  await dbClient.orderItems.deleteMany();
  
  // 2. Outras tabelas de relacionamento N:N
  await dbClient.expenseProcedures.deleteMany();
  await dbClient.expenseProducts.deleteMany();
  await dbClient.expenseMachines.deleteMany();
  await dbClient.productRecipe.deleteMany();
  await dbClient.customerPackaging.deleteMany();
  
  // 3. Tabelas que dependem de outras entidades principais
  await dbClient.expenses.deleteMany();
  await dbClient.expenseActor.deleteMany();
  await dbClient.materialOrders.deleteMany();
  await dbClient.prices.deleteMany();
  await dbClient.stock.deleteMany();
  await dbClient.salesForecasts.deleteMany();
  await dbClient.customerMessageSchedule.deleteMany();
  await dbClient.customerMessageConfig.deleteMany();
  await dbClient.vacations.deleteMany();
  await dbClient.workHours.deleteMany();
  await dbClient.schedules.deleteMany();
  
  // 4. Orders por último (depois de todas suas dependências)
  await dbClient.orders.deleteMany();
  
  // 5. Tabelas independentes e de configuração
  await dbClient.messageTemplate.deleteMany();
  await dbClient.timeConfiguration.deleteMany();
  await dbClient.packaging.deleteMany();
  
  // 6. Entidades principais (ordem inversa de dependência)
  await dbClient.procedures.deleteMany();
  await dbClient.machines.deleteMany();
  await dbClient.locations.deleteMany();
  await dbClient.products.deleteMany();
  await dbClient.vendors.deleteMany();
  await dbClient.employees.deleteMany();
  await dbClient.customers.deleteMany();
  await dbClient.adresses.deleteMany();
  await dbClient.users.deleteMany();
  await dbClient.moldes.deleteMany();
  await dbClient.espumas.deleteMany();
  await dbClient.cores.deleteMany();

  console.log("✅ Dados limpos com sucesso!");
  console.log("🌱 Iniciando criação de seeds...");

  // Criando usuários com diferentes níveis de acesso
  const userTypes = [
    { email: "admin@pontalti.com", name: "Admin Master", access_level: "administrator" as const },
    { email: "gerente@pontalti.com", name: "Gerente", access_level: "administrator" as const },
    { email: "vendedor@pontalti.com", name: "Vendedor", access_level: "standard" as const },
    { email: "operador@pontalti.com", name: "Operador", access_level: "standard" as const }
  ];

  console.log("👥 Criando usuários...");
  for (const userType of userTypes) {
    await dbClient.users.create({
      data: {
        ...userType,
        password: await bcrypt.hash("123", 10),
      }
    });
  }

  // Criando catálogos de Cores, Espumas e Moldes
  console.log("🎨 Criando catálogos (Cores, Espumas, Moldes)...");
  const coresSeed = [
    { name: "Preto", short_code: "PRT", hex_code: "#000000" },
    { name: "Branco", short_code: "BCO", hex_code: "#FFFFFF" },
    { name: "Bege", short_code: "BEG", hex_code: "#D5B895" },
    { name: "Marrom", short_code: "MRR", hex_code: "#6B4423" },
    { name: "Vermelho", short_code: "VRM", hex_code: "#D32F2F" }
  ];
  for (const cor of coresSeed) {
    await dbClient.cores.upsert({
      where: { name: cor.name },
      update: { short_code: cor.short_code, hex_code: cor.hex_code, status: 1 },
      create: { ...cor, status: 1 }
    });
  }

  const espumasSeed = [
    { name: "D28", short_code: "D28", size: "28kg/m³", description: null as string | null },
    { name: "D33", short_code: "D33", size: "33kg/m³", description: null as string | null },
    { name: "D40", short_code: "D40", size: "40kg/m³", description: null as string | null }
  ];
  for (const espuma of espumasSeed) {
    await dbClient.espumas.upsert({
      where: { name: espuma.name },
      update: {
        short_code: espuma.short_code,
        size: espuma.size,
        description: espuma.description,
        status: 1
      },
      create: { ...espuma, status: 1 }
    });
  }

  const moldesSeed = [
    { name: "Molde P", short_code: "MP", size: "P", description: "Tamanho 18" },
    { name: "Molde M", short_code: "MM", size: "M", description: "Tamanho 20" },
    { name: "Molde G", short_code: "MG", size: "G", description: "Tamanho 22" },
    { name: "Molde GG", short_code: "MGG", size: "GG", description: "Tamanho 24" }
  ];
  for (const molde of moldesSeed) {
    await dbClient.moldes.upsert({
      where: { name: molde.name },
      update: {
        short_code: molde.short_code,
        size: molde.size,
        description: molde.description,
        status: 1
      },
      create: { ...molde, status: 1 }
    });
  }

  // Criando endereços
  console.log("🏠 Criando endereços...");
  const addressesData = [
    {
      zip_code: "01311-000",
      neighborhood: "Bela Vista",
      public_place: "Avenida Paulista",
      city: "São Paulo",
      state: "SP",
      complement: "Sala 1001",
      address_number: 1000
    },
    {
      zip_code: "20040-020",
      neighborhood: "Centro",
      public_place: "Rua do Ouvidor",
      city: "Rio de Janeiro",
      state: "RJ",
      complement: "Andar 5",
      address_number: 50
    },
    {
      zip_code: "90050-170",
      neighborhood: "Centro Histórico",
      public_place: "Rua dos Andradas",
      city: "Porto Alegre",
      state: "RS",
      complement: "Loja 10",
      address_number: 123
    }
  ];

  const createdAddresses = [];
  for (const address of addressesData) {
    const createdAddress = await dbClient.adresses.create({
      data: address
    });
    createdAddresses.push(createdAddress);
  }

  // Criando clientes
  console.log("🛒 Criando clientes...");
  const customerTypes = [
    { store_name: "Loja Premium", credit_limit: 50000, deliver: true, pontalti: true },
    { store_name: "Loja Standard", credit_limit: 20000, deliver: true, pontalti: false },
    { store_name: "Loja Básica", credit_limit: 5000, deliver: false, pontalti: false }
  ];

  for (let i = 1; i <= 10; i++) {
    const customerType = getRandomElement(customerTypes);
    const address = getRandomElement(createdAddresses);
    
    await dbClient.customers.create({
      data: {
        status: Math.floor(Math.random() * 2),
        address_id: address.id,
        credit_limit: customerType.credit_limit,
        debts: getRandomNumber(0, customerType.credit_limit * 0.3),
        name: `Cliente ${i}`,
        phone: `1199999${i.toString().padStart(4, '0')}`,
        cel_number: `1198888${i.toString().padStart(4, '0')}`,
        email: `cliente${i}@email.com`,
        store_name: customerType.store_name,
        deliver: customerType.deliver,
        pontalti: customerType.pontalti,
        secondary_line: Math.random() > 0.5,
        cpf: `1234567890${i}`,
        created_at: getRandomDate(new Date(2023, 0, 1), new Date()),
        updated_at: new Date()
      }
    });
  }

  // Criando funcionários
  console.log("👨‍💼 Criando funcionários...");
  const classifications = [1, 2, 3]; // 1: Operador, 2: Supervisor, 3: Gerente
  const salaryRanges = {
    1: { min: 2000, max: 3000 },
    2: { min: 3000, max: 5000 },
    3: { min: 5000, max: 8000 }
  };

  for (let i = 1; i <= 8; i++) {
    const classification = getRandomElement(classifications);
    const salaryRange = salaryRanges[classification];
    
    const employee = await dbClient.employees.create({
      data: {
        email: `funcionario${i}@pontalti.com`,
        name: `Funcionário ${i}`,
        phone: `1197777${i.toString().padStart(4, '0')}`,
        cel_number: `1196666${i.toString().padStart(4, '0')}`,
        cpf: `9876543210${i}`,
        classification,
        admission: getRandomDate(new Date(2020, 0, 1), new Date()),
        salary: getRandomNumber(salaryRange.min, salaryRange.max),
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criando horários para cada funcionário
    for (let day = 0; day <= 6; day++) {
      await dbClient.schedules.create({
        data: {
          employee_id: employee.id,
          day_of_week: day,
          start_time: "08:00:00",
          end_time: "17:00:00"
        }
      });
    }
  }

  // Criando localizações
  console.log("📍 Criando localizações...");
  const locationsData = [
    { name: "Ilha 1", code: "ILHA-1", color: "#3b82f6", width: 200, height: 150 },
    { name: "Ilha 2", code: "ILHA-2", color: "#22c55e", width: 200, height: 150 },
    { name: "Setor A", code: "SETOR-A", color: "#ef4444", width: 250, height: 180 },
    { name: "Setor B", code: "SETOR-B", color: "#eab308", width: 250, height: 180 },
    { name: "Galpão A", code: "GALP-A", color: "#a855f7", width: 300, height: 200 },
    { name: "Galpão B", code: "GALP-B", color: "#f97316", width: 300, height: 200 },
    { name: "Depósito Central", code: "DEP-CENTRAL", color: "#06b6d4", width: 350, height: 250 },
    { name: "Setor C", code: "SETOR-C", color: "#6366f1", width: 250, height: 180 }
  ];

  const createdLocations = [];
  for (let i = 0; i < locationsData.length; i++) {
    const loc = locationsData[i];
    const createdLocation = await dbClient.locations.create({
      data: {
        name: loc.name,
        code: loc.code,
        status: 1,
        position_x: (i % 4) * 320 + 50,
        position_y: Math.floor(i / 4) * 280 + 50,
        width: loc.width,
        height: loc.height,
        color: loc.color,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdLocations.push(createdLocation);
  }

  // Criando máquinas
  console.log("🏭 Criando máquinas...");
  const machineModels = ["Dublagem", "Corte", "Costura", "Acabamento"];

  for (let i = 1; i <= 10; i++) {
    await dbClient.machines.create({
      data: {
        model: getRandomElement(machineModels),
        machine_number: i,
        status: Math.floor(Math.random() * 2),
        location_id: getRandomElement(createdLocations).id,
        location_status: Math.floor(Math.random() * 3),
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  // Criando procedimentos
  const processNames = ["Corte", "Costura", "Acabamento", "Qualidade", "Embalagem"];
  
  for (let i = 1; i <= 8; i++) {
    await dbClient.procedures.create({
      data: {
        process_name: getRandomElement(processNames),
        status: Math.floor(Math.random() * 2),
        workers: Math.floor(Math.random() * 5) + 1,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  // Criando produtos
  const productTypes = [
    { name: "Bojo", model: "Casca", size: "18", character: "Sem aba" },
    { name: "Bojo", model: "Casca", size: "20", character: "Com aba" },
    { name: "Bojo", model: "Dublagem", size: "22", character: "Sem aba" },
    { name: "Bojo", model: "Dublagem", size: "24", character: "Com aba" }
  ];

  for (let i = 1; i <= 12; i++) {
    const productType = getRandomElement(productTypes);
    await dbClient.products.create({
      data: {
        status: Math.floor(Math.random() * 2),
        volume_sales: getRandomNumber(100, 1000),
        sales: getRandomNumber(50, 500),
        invoicing: getRandomNumber(1000, 10000),
        name: productType.name,
        model: productType.model,
        size: productType.size,
        character: productType.character,
        moldes: Math.floor(Math.random() * 5) + 1,
        equivalency: getRandomNumber(100, 1000),
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  // Criando fornecedores
  const createdVendors = [];
  for (let i = 1; i <= 6; i++) {
    const address = getRandomElement(createdAddresses);
    const vendor = await dbClient.vendors.create({
      data: {
        name: `Fornecedor ${i}`,
        address_id: address.id,
        store_name: `Loja Fornecedor ${i}`,
        cnpj: `1234567890123${i}`,
        status: Math.floor(Math.random() * 2),
        phone: `1195555${i.toString().padStart(4, '0')}`,
        cel_number: `1194444${i.toString().padStart(4, '0')}`,
        deliver: Math.random() > 0.3,
        volume_purchases: getRandomNumber(1000, 5000),
        purchases: getRandomNumber(100, 500),
        invoicing: getRandomNumber(5000, 20000),
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdVendors.push(vendor);
  }

  // Criando registros de ponto
  const employees = await dbClient.employees.findMany();
  const startDate = new Date(2024, 0, 1);
  const endDate = new Date();

  for (const employee of employees) {
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      // Registro de entrada
      await dbClient.workHours.create({
        data: {
          employee_id: employee.id,
          clock_in: new Date(currentDate.setHours(8, 0, 0, 0)),
          clock_out: new Date(currentDate.setHours(12, 0, 0, 0)),
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      // Registro de saída
      await dbClient.workHours.create({
        data: {
          employee_id: employee.id,
          clock_in: new Date(currentDate.setHours(13, 0, 0, 0)),
          clock_out: new Date(currentDate.setHours(17, 0, 0, 0)),
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Criando férias para cada funcionário
    // Cada funcionário terá 1 ou 2 períodos de férias em 2024
    const numVacations = Math.floor(Math.random() * 2) + 1;
    
    for (let i = 0; i < numVacations; i++) {
      // Data de início aleatória entre janeiro e outubro de 2024
      const startDate = new Date(2025, Math.floor(Math.random() * 10), Math.floor(Math.random() * 28) + 1);
      // Duração de 20 a 30 dias
      const duration = Math.floor(Math.random() * 11) + 20;
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + duration);

      await dbClient.vacations.create({
        data: {
          employee_id: employee.id,
          start_date: startDate,
          end_date: endDate,
          sold_days: Math.floor(Math.random() * 10), // 0 a 10 dias vendidos
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando configurações de horário
  const weekDays = [
    { day: 0, name: "Domingo" },
    { day: 1, name: "Segunda" },
    { day: 2, name: "Terça" },
    { day: 3, name: "Quarta" },
    { day: 4, name: "Quinta" },
    { day: 5, name: "Sexta" },
    { day: 6, name: "Sábado" }
  ];

  for (const day of weekDays) {
    await dbClient.timeConfiguration.create({
      data: {
        day_of_week: day.day,
        work_start: "08:00:00",
        work_end: "17:00:00",
        late_limit_in_minutes: 15,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  // Criando pacotes (packagings)
  const packagingTypes = [
    { name: "Caixa Padrão", quantity: 100, storage_location: "Depósito A" },
    { name: "Caixa Grande", quantity: 50, storage_location: "Depósito B" },
    { name: "Caixa Pequena", quantity: 200, storage_location: "Depósito A" },
    { name: "Saco Plástico", quantity: 500, storage_location: "Depósito C" }
  ];

  const createdPackagings = [];
  for (const packaging of packagingTypes) {
    const createdPackaging = await dbClient.packaging.create({
      data: {
        ...packaging,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdPackagings.push(createdPackaging);
  }

  // Criando pedidos e entregas
  const customers = await dbClient.customers.findMany();
  const products = await dbClient.products.findMany();

  for (let i = 1; i <= 5; i++) {
    const customer = getRandomElement(customers);
    const order = await dbClient.orders.create({
      data: {
        final_price: getRandomNumber(1000, 5000),
        date: getRandomDate(new Date(2024, 0, 1), new Date()),
        customer_id: customer.id,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Adicionando produtos ao pedido
    const numProducts = Math.floor(Math.random() * 3) + 1;
    const usedProducts = new Set(); // Para evitar produtos duplicados no mesmo pedido
    
    for (let j = 0; j < numProducts; j++) {
      // Filtrar produtos que ainda não foram usados neste pedido
      const availableProducts = products.filter(p => !usedProducts.has(p.id));
      if (availableProducts.length === 0) break; // Se não houver mais produtos disponíveis, para o loop
      
      const product = getRandomElement(availableProducts);
      usedProducts.add(product.id); // Marca o produto como usado
      
      await dbClient.orderItems.create({
        data: {
          order_id: order.id,
          product_id: product.id,
          quantity: Math.floor(Math.random() * 5) + 1,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }

    // Criando entrega para o pedido
    const delivery = await dbClient.delivery.create({
      data: {
        order_id: order.id,
        status: Math.floor(Math.random() * 3) + 1, // 1: Em planejamento, 2: Em rota, 3: Entregue
        delivery_date: getRandomDate(new Date(), new Date(2024, 11, 31)),
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Adicionando pacotes à entrega
    const numPackagings = Math.floor(Math.random() * 3) + 1;
    const usedPackagings = new Set(); // Para evitar pacotes duplicados na mesma entrega
    
    for (let j = 0; j < numPackagings; j++) {
      // Filtrar pacotes que ainda não foram usados nesta entrega
      const availablePackagings = createdPackagings.filter(p => !usedPackagings.has(p.id));
      if (availablePackagings.length === 0) break; // Se não houver mais pacotes disponíveis, para o loop
      
      const packaging = getRandomElement(availablePackagings);
      usedPackagings.add(packaging.id); // Marca o pacote como usado
      
      await dbClient.deliveryPackaging.create({
        data: {
          delivery_id: delivery.id,
          packaging_id: packaging.id,
          quantity: Math.floor(Math.random() * 5) + 1,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando previsões de venda (SalesForecasts) - 3 registros mock
  const statusList = [1, 2, 3, 4]; // 1: Pendente, 2: Aceito, 3: Rejeitado, 4: Ordenado
  const reasons = [
    "média móvel 3 pedidos",
    "pedido recorrente (30 dias)",
    "sazonalidade (fim de ano)"
  ];

  for (let i = 0; i < 3; i++) {
    const customer = getRandomElement(customers);
    const product = getRandomElement(products);
    const freq = [15, 30, 45][i % 3];
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + freq);

    await dbClient.salesForecasts.create({
      data: {
        customer: { connect: { id: customer.id } },
        product: { connect: { id: product.id } },
        status: statusList[i],
        reason: reasons[i],
        next_estimated_date: nextDate,
        frequency_days: freq,
        quantity: Math.round(getRandomNumber(10, 250)),
        created_by: "seed",
        updated_by: "seed",
      }
    });
  }

  // Criando impressões de etiqueta (LabelPrints) - 3 registros mock
  const someOrders = await dbClient.orders.findMany({ take: 3, orderBy: { id: 'desc' }});
  for (const ord of someOrders) {
    await dbClient.labelPrints.create({
      data: {
        order: { connect: { id: ord.id } },
        created_by: 'seed',
        updated_by: 'seed'
      }
    });
  }

  // Criando configurações de mensagem para clientes
  const customersForMessages = await dbClient.customers.findMany({ take: 5 });
  
  for (const customer of customersForMessages) {
    const messageConfig = await dbClient.customerMessageConfig.create({
      data: {
        customer_id: customer.id,
        can_whatsapp: Math.random() > 0.3,
        can_whatsapp_attachments: Math.random() > 0.5,
        can_telegram: Math.random() > 0.3,
        can_telegram_attachments: Math.random() > 0.5,
        can_email: Math.random() > 0.2,
        can_email_attachments: Math.random() > 0.4,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // Criando horários para envio de mensagens
    for (let day = 0; day <= 6; day++) {
      await dbClient.customerMessageSchedule.create({
        data: {
          message_config_id: messageConfig.id,
          day_of_week: day,
          can_send: Math.random() > 0.3,
          start_time: "09:00",
          end_time: "18:00",
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando templates de mensagem
  const messageTemplates = [
    {
      name: "Boas-vindas",
      description: "Mensagem de boas-vindas para novos clientes",
      subject: "Bem-vindo à Pontalti!",
      content: "Olá {{nome}}, seja bem-vindo à Pontalti! Estamos felizes em tê-lo como cliente.",
      variables: { nome: "string" }
    },
    {
      name: "Pedido Confirmado",
      description: "Confirmação de pedido",
      subject: "Seu pedido foi confirmado",
      content: "Olá {{nome}}, seu pedido #{{pedido}} foi confirmado e está em processamento.",
      variables: { nome: "string", pedido: "number" }
    },
    {
      name: "Entrega Realizada",
      description: "Confirmação de entrega",
      subject: "Seu pedido foi entregue",
      content: "Olá {{nome}}, seu pedido #{{pedido}} foi entregue com sucesso!",
      variables: { nome: "string", pedido: "number" }
    }
  ];

  for (const template of messageTemplates) {
    await dbClient.messageTemplate.create({
      data: {
        ...template,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  // Criando relações entre clientes e embalagens
  for (const customer of customers) {
    // Cada cliente terá entre 2 e 4 tipos de embalagem
    const numPackagings = Math.floor(Math.random() * 3) + 2;
    const selectedPackagings = [...createdPackagings]
      .sort(() => Math.random() - 0.5)
      .slice(0, numPackagings);

    for (const packaging of selectedPackagings) {
      await dbClient.customerPackaging.create({
        data: {
          customer_id: customer.id,
          packaging_id: packaging.id,
          pontalti_brand: Math.random() > 0.5, // 50% de chance de ser marca Pontalti
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando pedidos de materiais (MaterialOrders)
  const createdMaterialOrders = [];
  const materialTypes = [
    { name: "Resina PET", unit: "kg" },
    { name: "Tecido TNT", unit: "m" },
    { name: "Adesivo Transparente", unit: "litros" },
    { name: "Espuma D28", unit: "m²" },
    { name: "Elástico", unit: "m" },
    { name: "Linha Poliester", unit: "kg" }
  ];

  for (let i = 0; i < 15; i++) {
    const vendor = getRandomElement(createdVendors);
    const product = getRandomElement(products);
    const materialType = getRandomElement(materialTypes);
    
    const materialOrder = await dbClient.materialOrders.create({
      data: {
        date: getRandomDate(new Date(2024, 0, 1), new Date()),
        amount: Math.floor(getRandomNumber(10, 500)),
        unit: materialType.unit,
        storage_location: getRandomElement(["Galpão A", "Galpão B", "Depósito Central", "Setor C"]),
        received_by: `Funcionário ${Math.floor(Math.random() * 8) + 1}`,
        product_id: product.id,
        vendor_id: vendor.id,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdMaterialOrders.push(materialOrder);
  }

  // Criando receitas de produtos (ProductRecipe)
  const createdProductRecipes = [];
  
  // Cada produto final terá entre 2 e 4 materiais/componentes
  for (const product of products) {
    const numMaterials = Math.floor(Math.random() * 3) + 2; // 2 a 4 materiais
    const usedMaterialOrders = new Set();
    
    for (let i = 0; i < numMaterials; i++) {
      // Filtrar material orders que ainda não foram usados para este produto
      const availableMaterialOrders = createdMaterialOrders.filter(mo => !usedMaterialOrders.has(mo.id));
      if (availableMaterialOrders.length === 0) break;
      
      const materialOrder = getRandomElement(availableMaterialOrders);
      usedMaterialOrders.add(materialOrder.id);
      
      const productRecipe = await dbClient.productRecipe.create({
        data: {
          product_id: product.id,
          material_order_id: materialOrder.id,
          quantity_needed: getRandomNumber(0.1, 5.0), // Quantidade necessária por unidade
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      createdProductRecipes.push(productRecipe);
    }
  }

  // Criando controles de produção expandidos (ProductionControl)
  const createdProductionControls = [];
  const orders = await dbClient.orders.findMany();
  
  for (const order of orders) {
    const productionControl = await dbClient.productionControl.create({
      data: {
        order_id: order.id,
        status: Math.floor(Math.random() * 4) + 1, // 1: Planejamento, 2: Em produção, 3: Concluído, 4: Cancelado
        material_disponibility: Math.floor(Math.random() * 3) + 1, // 1: Disponível, 2: Parcial, 3: Indisponível
        estimated_start_date: getRandomDate(new Date(), new Date(2024, 11, 31)),
        estimated_end_date: getRandomDate(new Date(2024, 6, 1), new Date(2024, 11, 31)),
        actual_start_date: Math.random() > 0.5 ? getRandomDate(new Date(2024, 0, 1), new Date()) : null,
        actual_end_date: Math.random() > 0.7 ? getRandomDate(new Date(2024, 0, 1), new Date()) : null,
        production_priority: Math.floor(Math.random() * 4) + 1, // 1: Urgente, 2: Alta, 3: Normal, 4: Baixa
        observations: Math.random() > 0.5 ? `Observação para pedido #${order.id}` : null,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdProductionControls.push(productionControl);
  }

  // Criando consumo de materiais (MaterialConsumption)
  for (const productionControl of createdProductionControls) {
    // Cada controle de produção terá entre 2 e 5 consumos de materiais
    const numConsumptions = Math.floor(Math.random() * 4) + 2;
    const usedMaterialOrders = new Set();
    
    for (let i = 0; i < numConsumptions; i++) {
      const availableMaterialOrders = createdMaterialOrders.filter(mo => !usedMaterialOrders.has(mo.id));
      if (availableMaterialOrders.length === 0) break;
      
      const materialOrder = getRandomElement(availableMaterialOrders);
      usedMaterialOrders.add(materialOrder.id);
      
      const plannedConsumption = getRandomNumber(1, 50);
      const actualConsumption = Math.random() > 0.3 ? getRandomNumber(0.8 * plannedConsumption, 1.2 * plannedConsumption) : null;
      const variance = actualConsumption ? actualConsumption - plannedConsumption : null;
      
      await dbClient.materialConsumption.create({
        data: {
          production_control_id: productionControl.id,
          material_order_id: materialOrder.id,
          planned_consumption: plannedConsumption,
          actual_consumption: actualConsumption,
          variance: variance,
          consumption_date: actualConsumption ? getRandomDate(new Date(2024, 0, 1), new Date()) : null,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando estoque para produtos (complementando Stock existente)
  for (const product of products) {
    // Verificar se já existe estoque para este produto
    const existingStock = await dbClient.stock.findFirst({
      where: { product_id: product.id }
    });

    if (!existingStock) {
      await dbClient.stock.create({
        data: {
          amount: Math.floor(getRandomNumber(0, 1000)),
          location_id: getRandomElement(createdLocations).id,
          product_id: product.id,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
  }

  // Criando preços para produtos
  for (const product of products) {
    // Cada produto terá um preço padrão (customer_id null)
    await dbClient.prices.create({
      data: {
        product_id: product.id,
        customer_id: null, // Preço padrão
        production_cost: getRandomNumber(5, 25),
        operational_margin: getRandomNumber(20, 40),
        final_price: getRandomNumber(10, 50),
        second_line_price: Math.random() > 0.5 ? getRandomNumber(8, 45) : null,
        frozen_until: Math.random() > 0.7 ? getRandomDate(new Date(), new Date(2024, 11, 31)) : null,
        status: getRandomElement(["verde", "amarelo", "vermelho"]),
        created_at: new Date()
      }
    });
    
    // Alguns produtos terão preços específicos para clientes
    if (Math.random() > 0.6) {
      const customer = getRandomElement(customers);
      try {
        await dbClient.prices.create({
          data: {
            product_id: product.id,
            customer_id: customer.id,
            production_cost: getRandomNumber(5, 25),
            operational_margin: getRandomNumber(15, 35), // Margem diferente para cliente específico
            final_price: getRandomNumber(8, 45),
            second_line_price: Math.random() > 0.5 ? getRandomNumber(6, 40) : null,
            frozen_until: Math.random() > 0.8 ? getRandomDate(new Date(), new Date(2024, 11, 31)) : null,
            status: getRandomElement(["verde", "amarelo", "vermelho"]),
            created_at: new Date()
          }
        });
      } catch (error) {
        // Ignorar erro se já existe preço para este produto/cliente
        console.log(`Preço já existe para produto ${product.id} e cliente ${customer.id}`);
      }
    }
  }

  // Criando atores de despesas (ExpenseActor)
  const createdExpenseActors = [];
  
  // Atores baseados em funcionários
  const someEmployees = employees.slice(0, 3);
  for (const employee of someEmployees) {
    const expenseActor = await dbClient.expenseActor.create({
      data: {
        first_name: employee.name.split(' ')[0],
        last_name: employee.name.split(' ').slice(1).join(' '),
        whatsapp_telegram: employee.cel_number,
        store_name: null,
        employee_id: employee.id,
        vendor_id: null,
        customer_id: null,
        order_id: null,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdExpenseActors.push(expenseActor);
  }

  // Atores baseados em fornecedores
  const someVendors = createdVendors.slice(0, 2);
  for (const vendor of someVendors) {
    const expenseActor = await dbClient.expenseActor.create({
      data: {
        first_name: vendor.name.split(' ')[0],
        last_name: vendor.name.split(' ').slice(1).join(' '),
        whatsapp_telegram: vendor.cel_number,
        store_name: vendor.store_name,
        employee_id: null,
        vendor_id: vendor.id,
        customer_id: null,
        order_id: null,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdExpenseActors.push(expenseActor);
  }

  // Atores baseados em clientes
  const someCustomers = customers.slice(0, 2);
  for (const customer of someCustomers) {
    const expenseActor = await dbClient.expenseActor.create({
      data: {
        first_name: customer.name.split(' ')[0],
        last_name: customer.name.split(' ').slice(1).join(' '),
        whatsapp_telegram: customer.cel_number,
        store_name: customer.store_name,
        employee_id: null,
        vendor_id: null,
        customer_id: customer.id,
        order_id: null,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdExpenseActors.push(expenseActor);
  }

  // Criando despesas (Expenses)
  const expenseClassifications = [
    "Manutenção",
    "Suprimentos",
    "Transporte",
    "Energia",
    "Comunicação",
    "Consultoria",
    "Treinamento",
    "Equipamentos"
  ];

  const expenseDescriptions = [
    "Manutenção preventiva de máquinas",
    "Compra de material de escritório",
    "Combustível para entregas",
    "Conta de energia elétrica",
    "Serviços de internet e telefone",
    "Consultoria em qualidade",
    "Treinamento de funcionários",
    "Aquisição de novos equipamentos",
    "Reparo de equipamento danificado",
    "Material de limpeza",
    "Seguro de equipamentos",
    "Taxa de licenciamento"
  ];

  const justifications = [
    "Necessário para manter operação funcionando",
    "Aprovado pela diretoria para melhorar eficiência",
    "Urgente para atender demanda de cliente",
    "Manutenção preventiva obrigatória",
    "Investimento em qualidade do produto",
    "Redução de custos operacionais",
    "Melhoria do ambiente de trabalho",
    "Conformidade com normas regulamentares"
  ];

  const createdExpenses = [];
  
  for (let i = 0; i < 20; i++) {
    const expenseActor = getRandomElement(createdExpenseActors);
    const expense = await dbClient.expenses.create({
      data: {
        amount: getRandomNumber(50, 5000),
        classification: getRandomElement(expenseClassifications),
        description: getRandomElement(expenseDescriptions),
        justification: getRandomElement(justifications),
        requires_reimbursement: Math.random() > 0.7, // 30% requer reembolso
        applies_all_products: Math.random() > 0.8, // 20% aplica a todos produtos
        applies_all_machines: Math.random() > 0.8, // 20% aplica a todas máquinas
        expense_date: getRandomDate(new Date(2024, 0, 1), new Date()),
        expense_actor_id: expenseActor.id,
        created_by: "seed",
        updated_by: "seed",
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    createdExpenses.push(expense);
  }

  // Criando relacionamentos ExpenseMachines
  const machines = await dbClient.machines.findMany();
  
  for (const expense of createdExpenses) {
    // Se não aplica a todas as máquinas, criar relacionamentos específicos
    if (!expense.applies_all_machines && Math.random() > 0.5) {
      const numMachines = Math.floor(Math.random() * 3) + 1; // 1 a 3 máquinas
      const selectedMachines = [...machines]
        .sort(() => Math.random() - 0.5)
        .slice(0, numMachines);
      
      for (const machine of selectedMachines) {
        try {
          await dbClient.expenseMachines.create({
            data: {
              expense_id: expense.id,
              machine_id: machine.id
            }
          });
        } catch (error) {
          // Ignorar se já existe relação
        }
      }
    }
  }

  // Criando relacionamentos ExpenseProducts
  for (const expense of createdExpenses) {
    // Se não aplica a todos os produtos, criar relacionamentos específicos
    if (!expense.applies_all_products && Math.random() > 0.5) {
      const numProducts = Math.floor(Math.random() * 4) + 1; // 1 a 4 produtos
      const selectedProducts = [...products]
        .sort(() => Math.random() - 0.5)
        .slice(0, numProducts);
      
      for (const product of selectedProducts) {
        try {
          await dbClient.expenseProducts.create({
            data: {
              expense_id: expense.id,
              product_id: product.id
            }
          });
        } catch (error) {
          // Ignorar se já existe relação
        }
      }
    }
  }

  // Criando relacionamentos ExpenseProcedures
  const procedures = await dbClient.procedures.findMany();
  
  for (const expense of createdExpenses) {
    // 40% das despesas estão relacionadas a procedimentos
    if (Math.random() > 0.6) {
      const numProcedures = Math.floor(Math.random() * 2) + 1; // 1 a 2 procedimentos
      const selectedProcedures = [...procedures]
        .sort(() => Math.random() - 0.5)
        .slice(0, numProcedures);
      
      for (const procedure of selectedProcedures) {
        try {
          await dbClient.expenseProcedures.create({
            data: {
              expense_id: expense.id,
              procedure_id: procedure.id
            }
          });
        } catch (error) {
          // Ignorar se já existe relação
        }
      }
    }
  }

  // Criando relacionamentos ExpenseOrders
  for (const expense of createdExpenses) {
    // 30% das despesas estão relacionadas a pedidos específicos
    if (Math.random() > 0.7) {
      const numOrders = Math.floor(Math.random() * 2) + 1; // 1 a 2 pedidos
      const selectedOrders = [...orders]
        .sort(() => Math.random() - 0.5)
        .slice(0, numOrders);
      
      for (const order of selectedOrders) {
        try {
          await dbClient.expenseOrders.create({
            data: {
              expense_id: expense.id,
              order_id: order.id
            }
          });
        } catch (error) {
          // Ignorar se já existe relação
        }
      }
    }
  }
  
  console.log("🎉 Seeds criados com sucesso!");
  console.log("📊 Resumo dos dados criados:");
  console.log(`   - ${userTypes.length} usuários`);
  console.log(`   - ${addressesData.length} endereços`);
  console.log(`   - 10 clientes`);
  console.log(`   - 8 funcionários`);
  console.log(`   - 10 máquinas`);
  console.log(`   - 8 procedimentos`);
  console.log(`   - 12 produtos`);
  console.log(`   - 6 fornecedores`);
  console.log(`   - 15 pedidos de materiais`);
  console.log(`   - 5 pedidos de vendas`);
  console.log(`   - 7 atores de despesas`);
  console.log(`   - 20 despesas + relacionamentos`);
  console.log(`   - E muito mais...`);
  console.log("✨ Banco de dados populado e pronto para uso!");
}

main()
  .catch((error) => {
    console.log(error);
  })
  .finally(async () => {
    await dbClient.$disconnect();
    process.exit(0);
  });
