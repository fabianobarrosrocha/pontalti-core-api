import { Customer, CustomerRegister, CustomerRequest } from "@pontalti/types/customer.types";
import { assertCustomerMutation, customerFinanceLock } from "@pontalti/modules/v1/customer-finance/legacy";
import prisma, { dbErrorHandle } from "@pontalti/lib/prisma";
import { CommonRequest, PaginationResponse } from "@pontalti/types/common.types";

const defaultSelectedFieldForCustomers = {
  id: true,
  status: true,
  address_id: true,
  credit_limit: true,
  debts: true,
  name: true,
  phone: true,
  cel_number: true,
  email: true,
  store_name: true,
  deliver: true,
  pontalti: true,
  secondary_line: true,
  cpf: true,
  cnpj: true,
  created_at: true,
  updated_at: true,
  address: {
    select: {
      id: true,
      zip_code: true,
      neighborhood: true,
      public_place: true,
      city: true,
      state: true,
      complement: true,
      address_number: true
    }
  }
};

const createCustomer = async (data: CustomerRegister): Promise<Customer> => {
  try {
    const { address, ...customerData } = data;
    return await prisma.customers.create({
      data: {
        ...customerData,
        address: {
          create: address
        },
        created_at: new Date(),
        updated_at: new Date()
      },
      include: {
        address: true
      }
    });
  } catch(e) {
    console.log(e)
    dbErrorHandle(e)
  }

};

const getCustomer = async (id: number): Promise<Customer> => {
  try {
    return await prisma.customers.findUnique({ where: { id }, select: defaultSelectedFieldForCustomers });
  } catch(e) {
    dbErrorHandle(e)
  }
};

const getCustomers = async (filters: CustomerRequest): Promise<PaginationResponse<Customer>> => {
  try {
    const {
      page,
      perPage,
      id,
      name,
      cpf,
      cnpj,
      store_name,
      cel_number,
      phone,
      pontalti,
      status,
      deliver,
      secondary_line
    } = filters;

    const skip = page !== 1 && page != undefined ? (page - 1) * perPage : undefined;

    // prettier-ignore
    const whereClause = id ? { id } : {
      name: { contains: name },
      cpf: { contains: cpf },
      cnpj: { contains: cnpj },
      store_name: { contains: store_name },
      cel_number: { contains: cel_number },
      phone: { contains: phone },
      pontalti: pontalti,
      status: status,
      deliver: deliver,
      secondary_line: secondary_line
    };

    const result = await prisma.customers.findMany({
      where: whereClause,
      select: defaultSelectedFieldForCustomers,
      take: perPage,
      skip: skip
    });

    const totalRecords = await prisma.customers.count({
      where: whereClause
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customers = result.map((item: any) => {
      return { ...item } as Customer;
    });

    const hasMoreItems = await prisma.customers.count({
      where: {
        id: {
          gt: customers[customers.length - 1]?.id || 0
        }
      }
    });

    const nextPage = hasMoreItems ? page! + 1 : undefined;

    return {
      data: customers,
      totalRecord: totalRecords,
      page: page ?? 1,
      perPage: perPage,
      nextPage: nextPage ? `/api/customers?page=${nextPage}` : undefined
    } as PaginationResponse<Customer>;
  } catch(e) {
    dbErrorHandle(e)
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updatePartialCustomer = async (id: number, data: any): Promise<Customer> => {
  return prisma.$transaction(async tx => {
    await customerFinanceLock(tx);
    await assertCustomerMutation(tx, id, data);
    return tx.customers.update({ where: { id }, data: { ...data, updated_at: new Date() }, select: defaultSelectedFieldForCustomers });
  });
};

const deleteCustomer = async (id: number): Promise<Customer> => {
  try{
    return await prisma.customers.delete({ where: { id }, select: defaultSelectedFieldForCustomers });
  } catch(e) {
    dbErrorHandle(e)
  }
};

export default {
  createCustomer,
  getCustomer,
  getCustomers,
  updatePartialCustomer,
  deleteCustomer
};
