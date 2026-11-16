export const SALES_PRODUCTS=['FLIGHT','HOTEL','INSURANCE','VISA','HOLIDAY','CRUISE'] as const;
/** These enquiries require their service team's fulfilment process. */
export const canConvertSalesProduct=(product:string)=>['FLIGHT','HOTEL','INSURANCE'].includes(product);
