import { Customer, CustomerRequest, CustomerStatusString, UpdatePartialCustomer } from "@pontalti/types/customer.types";
import { PaginationResponse, Status } from "@pontalti/types/common.types";
import repository from "@pontalti/repository/customer";
import { BusinessError } from "@pontalti/utils/errors";

const createCustomer = async (data: Customer) => {
  try {
    return convertCustomerStatusToString((await repository.createCustomer(data)) as Customer);
  } catch (e: any) {
    throw e;
  }
};

const getAllCustomers = async (filters: CustomerRequest) => {
  try {
    return convertPaginatedCustomerStatusToString((await repository.getCustomers(filters)) as PaginationResponse<Customer>);
  } catch (e: any) {
    throw e;
  }
};

const getCustomerById = async (id: number) => {
  try {
    return convertCustomerStatusToString((await repository.getCustomer(id)) as Customer);
  } catch (e: any) {
    throw e;
  }
};

const updatePartialCustomer = async (id: number, data: UpdatePartialCustomer) => {
  try {
    const credit_limit = data.credit_limit ?? (await repository.getCustomer(id)).credit_limit
    const debts = data.debts ?? (await repository.getCustomer(id)).debts
    
    if(data.status && debts > credit_limit && data.status == 1){
      throw new BusinessError("Não foi possível atualizar o status do cliente, pois o cliente possui mais dividas do que limite de crédito")
    }
    
    if(data.debts && data.debts > credit_limit){
      data.status = 0
    }

    return convertCustomerStatusToString((await repository.updatePartialCustomer(id, data)) as Customer);
  } catch (e: any) {
    throw e;
  }
};

const deleteCustomer = async (id: number) => {
  try {
    return convertCustomerStatusToString((await repository.deleteCustomer(id)) as Customer);
  } catch (e: any) {
    throw e;
  }
};

const convertPaginatedCustomerStatusToString = (paginatedCustomers: PaginationResponse<Customer>) => {
  const { data, ...paginationInfos } = paginatedCustomers;
  const customers = data.map(convertCustomerStatusToString);
  return { data: customers, ...paginationInfos } as PaginationResponse<CustomerStatusString>;
}

const convertCustomerStatusToString = (customer: Customer) => {
  const { status, ...otherCustomerAttributes } = customer;
  return {...otherCustomerAttributes, status: Status[status]}

}


export default {
  createCustomer,
  getCustomerById,
  getAllCustomers,
  updatePartialCustomer,
  deleteCustomer
};
