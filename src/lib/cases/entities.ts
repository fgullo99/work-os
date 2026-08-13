/** Los Cases usan las mismas tablas company/contact/context que los Work Items (item 2 del
 * pedido: "reutilizar... companies/contacts/contexts") — sin duplicar la logica. */
export {
  listCompanies,
  createCompany,
  listContacts,
  createContact,
  listContexts,
  createContext,
  findBestMatch,
} from "@/lib/workItems/entities";
