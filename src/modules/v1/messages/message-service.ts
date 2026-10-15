import { DefaultResponse } from "@pontalti/types/common.types";
import { CustomerMessageConfig, CustomerMessageSchedule, MessageTemplate } from "@prisma/client";
import {
  CreateMessageConfig,
  UpdateMessageConfig,
  CreateMessageSchedule,
  UpdateMessageSchedule,
  CreateMessageTemplate,
  UpdateMessageTemplate
} from "@pontalti/types/message.types";
import repository from "@pontalti/repository/message";
import { NotFoundError } from "@pontalti/utils/errors";

// Customer Message Config
const createMessageConfig = async (data: CreateMessageConfig): Promise<DefaultResponse<CustomerMessageConfig>> => {
  try {
    const response = await repository.createMessageConfig(data);
    return { data: response };
  } catch (e) {
    throw e;
  }
};

const getMessageConfigById = async (id: number): Promise<DefaultResponse<CustomerMessageConfig>> => {
  try {
    const config = await repository.getMessageConfigById(id);
    if (!config) {
      throw new NotFoundError("Configuração de mensagem não encontrada");
    }
    return { data: config };
  } catch (e) {
    throw e;
  }
};

const getMessageConfigByCustomerId = async (customer_id: number): Promise<DefaultResponse<CustomerMessageConfig>> => {
  try {
    const config = await repository.getMessageConfigByCustomerId(customer_id);
    if (!config) {
      throw new NotFoundError("Configuração de mensagem não encontrada para este cliente");
    }
    return { data: config };
  } catch (e) {
    throw e;
  }
};

const updateMessageConfig = async (id: number, data: UpdateMessageConfig): Promise<DefaultResponse<CustomerMessageConfig>> => {
  try {
    const existingConfig = await repository.getMessageConfigById(id);
    if (!existingConfig) {
      throw new NotFoundError("Configuração de mensagem não encontrada");
    }

    const updatedConfig = await repository.updateMessageConfig(id, data);
    return { data: updatedConfig };
  } catch (e) {
    throw e;
  }
};

const deleteMessageConfig = async (id: number): Promise<DefaultResponse<CustomerMessageConfig>> => {
  try {
    const existingConfig = await repository.getMessageConfigById(id);
    if (!existingConfig) {
      throw new NotFoundError("Configuração de mensagem não encontrada");
    }

    const deletedConfig = await repository.deleteMessageConfig(id);
    return { data: deletedConfig };
  } catch (e) {
    throw e;
  }
};

// Customer Message Schedule
const createMessageSchedule = async (data: CreateMessageSchedule): Promise<DefaultResponse<CustomerMessageSchedule>> => {
  try {
    const response = await repository.createMessageSchedule(data);
    return { data: response };
  } catch (e) {
    throw e;
  }
};

const updateMessageSchedule = async (id: number, data: UpdateMessageSchedule): Promise<DefaultResponse<CustomerMessageSchedule>> => {
  try {
    const response = await repository.updateMessageSchedule(id, data);
    return { data: response };
  } catch (e) {
    throw e;
  }
};

const deleteMessageSchedule = async (id: number): Promise<DefaultResponse<CustomerMessageSchedule>> => {
  try {
    const response = await repository.deleteMessageSchedule(id);
    return { data: response };
  } catch (e) {
    throw e;
  }
};

// Message Templates
const createMessageTemplate = async (data: CreateMessageTemplate): Promise<DefaultResponse<MessageTemplate>> => {
  try {
    const response = await repository.createMessageTemplate(data);
    return { data: response };
  } catch (e) {
    throw e;
  }
};

const getMessageTemplateById = async (id: string): Promise<DefaultResponse<MessageTemplate>> => {
  try {
    const template = await repository.getMessageTemplateById(id);
    if (!template) {
      throw new NotFoundError("Template de mensagem não encontrado");
    }
    return { data: template };
  } catch (e) {
    throw e;
  }
};

const getAllMessageTemplates = async (): Promise<DefaultResponse<MessageTemplate[]>> => {
  try {
    const templates = await repository.getAllMessageTemplates();
    return { data: templates };
  } catch (e) {
    throw e;
  }
};

const updateMessageTemplate = async (id: string, data: UpdateMessageTemplate): Promise<DefaultResponse<MessageTemplate>> => {
  try {
    const existingTemplate = await repository.getMessageTemplateById(id);
    if (!existingTemplate) {
      throw new NotFoundError("Template de mensagem não encontrado");
    }

    const updatedTemplate = await repository.updateMessageTemplate(id, data);
    return { data: updatedTemplate };
  } catch (e) {
    throw e;
  }
};

const deleteMessageTemplate = async (id: string): Promise<DefaultResponse<MessageTemplate>> => {
  try {
    const existingTemplate = await repository.getMessageTemplateById(id);
    if (!existingTemplate) {
      throw new NotFoundError("Template de mensagem não encontrado");
    }

    const deletedTemplate = await repository.deleteMessageTemplate(id);
    return { data: deletedTemplate };
  } catch (e) {
    throw e;
  }
};

export default {
  // Customer Message Config
  createMessageConfig,
  getMessageConfigById,
  getMessageConfigByCustomerId,
  updateMessageConfig,
  deleteMessageConfig,

  // Customer Message Schedule
  createMessageSchedule,
  updateMessageSchedule,
  deleteMessageSchedule,

  // Message Templates
  createMessageTemplate,
  getMessageTemplateById,
  getAllMessageTemplates,
  updateMessageTemplate,
  deleteMessageTemplate
};
