/** Manual hotel records reuse pnr as the supplier confirmation reference, never an airline PNR. */
export const MANUAL_HOTEL_STATUSES = ["ENQUIRY", "QUOTE_SENT", "ON_HOLD", "PAYMENT_AWAITED", "CONFIRMED", "CANCELLED", "VOID"];
export type HotelStay = {hotelName:string|null; hotelCheckIn:Date|null; hotelCheckOut:Date|null; pnr:string|null};
export function hotelStayProblem(stay:HotelStay, requireConfirmation=false):string|null {
 if(requireConfirmation&&(!stay.hotelName?.trim()||!stay.pnr?.trim()||!stay.hotelCheckIn||!stay.hotelCheckOut))return "Enter the hotel name, valid check-in/check-out dates and actual supplier confirmation reference before recording confirmation.";
 if(stay.hotelCheckIn&&!Number.isFinite(stay.hotelCheckIn.getTime())||stay.hotelCheckOut&&!Number.isFinite(stay.hotelCheckOut.getTime()))return "Enter valid hotel stay dates.";
 if(stay.hotelCheckIn&&stay.hotelCheckOut&&stay.hotelCheckOut<=stay.hotelCheckIn)return "Hotel check-out must be after check-in.";
 return null;
}
export function hotelDate(value:unknown):Date|null {
 if(value===null||value===undefined||value==="")return null;
 const text=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw Error("Use a valid hotel stay date (YYYY-MM-DD).");
 const result=new Date(text+"T00:00:00.000Z");if(!Number.isFinite(result.getTime())||result.toISOString().slice(0,10)!==text)throw Error("Use a valid hotel stay date (YYYY-MM-DD).");return result;
}
