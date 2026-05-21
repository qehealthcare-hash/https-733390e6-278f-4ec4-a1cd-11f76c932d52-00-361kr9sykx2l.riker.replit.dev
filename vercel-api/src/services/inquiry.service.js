import { createBaseService } from "./base-service.js";

const inquiryBase = createBaseService("inquiries");

export const inquiryService = {
  list: inquiryBase.list,
  getById: inquiryBase.getById,
  create: inquiryBase.insert,
  update: inquiryBase.update,
  remove: inquiryBase.remove
};
