import { Router } from "express";

import customers from '@pontalti/modules/v1/customers/routes'
import employees from '@pontalti/modules/v1/employees/routes'
import machines from '@pontalti/modules/v1/machines/routes'
import procedures from '@pontalti/modules/v1/procedures/routes'
import products from '@pontalti/modules/v1/products/routes'
import vendors from '@pontalti/modules/v1/vendors/routes'
import auth from "@pontalti/modules/v1/auth/routes";
import users from "@pontalti/modules/v1/users/routes";
import timeConfigurations from "@pontalti/modules/v1/time-configurations/routes";
import orders from "@pontalti/modules/v1/orders/routes";
import payments from "@pontalti/modules/v1/payments/routes";
import materialOrders from "@pontalti/modules/v1/material-orders/routes";
import productReturns from "@pontalti/modules/v1/product-returns/routes";
import prices from "@pontalti/modules/v1/prices/routes";
import messages from "@pontalti/modules/v1/messages/routes";
import invoices from "@pontalti/modules/v1/invoices/routes";
import packaging from "@pontalti/modules/v1/packaging/routes";
import customerPackaging from "@pontalti/modules/v1/customer-packaging/routes";
import delivery from "@pontalti/modules/v1/delivery/routes";
import deliveryPackaging from "@pontalti/modules/v1/delivery-packaging/routes";
import calendar from "@pontalti/modules/v1/calendar/routes";
import stocks from '@pontalti/modules/v1/stocks/routes'
import productionControl from '@pontalti/modules/v1/production-control/routes'
import salesForecasts from '@pontalti/modules/v1/sales-forecasts/routes'
import labelPrints from '@pontalti/modules/v1/label-prints/routes'
import expenses from '@pontalti/modules/v1/expenses/routes'
import purchaseForecast from '@pontalti/modules/v1/purchase-forecast/routes'
import locations from '@pontalti/modules/v1/locations/routes'
import timeAdjustmentRequests from '@pontalti/modules/v1/time-adjustment-requests/routes'

const routes = Router();

routes.get('/test', (req, res) => {
  res.status(200).json(req.headers);
});

routes.use('/customers', customers);
routes.use('/employees', employees);
routes.use('/machines', machines);
routes.use('/procedures', procedures);
routes.use('/products', products);
routes.use('/vendors', vendors);
routes.use('/authentication', auth);
routes.use('/users', users);
routes.use('/prices', prices);
routes.use('/messages', messages);
routes.use('/time-configurations', timeConfigurations);
routes.use('/orders', orders);
routes.use('/payments', payments);
routes.use('/material-orders', materialOrders);
routes.use('/product-returns', productReturns);
routes.use('/invoices', invoices);
routes.use('/packaging', packaging);
routes.use('/customer-packaging', customerPackaging);
routes.use('/delivery', delivery);
routes.use('/delivery-packaging', deliveryPackaging);
routes.use('/stocks', stocks);
routes.use('/production-control', productionControl);
routes.use('/sales-forecasts', salesForecasts);
routes.use('/label-prints', labelPrints);
routes.use('/expenses', expenses);
routes.use('/purchase-forecast', purchaseForecast);
routes.use("/calendar", calendar);
routes.use("/locations", locations);
routes.use("/time-adjustment-requests", timeAdjustmentRequests);

export default routes;
