import "dotenv/config";
import express, { Request, Response } from 'express';
import ErrorHandler from './src/middlewares/error-handler';
import versionRoutes from "@pontalti/modules/v1/routes"
import AuthenticationHandler from './src/middlewares/authentication-handler';
import { startSalesForecastCron } from "./src/tasks/cron-sales-forecast";
import { createBankingWebhook } from "./src/modules/v1/banking/routes";
import { startCoraPayrollWorker } from "./src/tasks/cora-payroll-worker";

import { createInternalFinanceRouter } from "./src/modules/v1/customer-finance/routes";
import { startCustomerDepositWorker } from "./src/tasks/customer-deposit-worker";

const app = express();
app.use('/api/v1/banking/payables/:id/receipts', AuthenticationHandler, express.json({ limit: '3mb' }));
app.use(express.json())
app.use('/api/v1/banking/webhook', createBankingWebhook());
app.use('/api/v1/commerce-finance', createInternalFinanceRouter());

app.use(AuthenticationHandler)

app.get('/', (req: Request, res: Response) => {
  return res.sendStatus(401);
});

// const versions = ['v1']

// versions.forEach(async (version) => {
//   const { default: versionRoutes } = await import('./src/modules/' + version + '/routes')
//   app.use('/api/' + version, versionRoutes)
// })

app.use('/api/v1', versionRoutes)

app.use(ErrorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  startSalesForecastCron();
  startCoraPayrollWorker();
  startCustomerDepositWorker();
});
