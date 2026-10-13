// Collection templates, not a substitute for the authority's applicant-specific checklist.
const item = (name, instructions, required = true, extra = {}) => ({name,instructions,required,fileTypes:"pdf,jpg,png",maxSizeMb:10,needsExpiry:false,needsVerification:true,travellerType:"ALL",...extra});
const passport = instructions => item("Passport",instructions,true,{needsExpiry:true});
const review = item("Applicant-specific official checklist review","Staff: attach the current authority/portal checklist, confirm consular jurisdiction and reconcile every requirement before submission. Add missing mandatory documents to the case.");
const templates = [
 {country:"United Kingdom",source:"https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk",items:[
  passport("Valid travel document; supply identity page and relevant travel history."),
  item("Visitor application confirmation","Complete the Standard Visitor application and follow its document instructions."),
  item("Financial circumstances","Evidence of accessible funds and their origin, consistent with the declared trip cost.",false),
  item("Work, study or business evidence","As applicable: employer letter, student evidence or business registration demonstrating circumstances in India.",false),
  item("Sponsor evidence — if sponsored","Support offered, funds, relationship and lawful UK status where applicable.",false),
  item("Minor relationship and travel consent","Under 18: birth/adoption evidence; parent identification and consent/travel-care arrangements as applicable.",false,{travellerType:"MINOR"})]},
 {country:"United States",source:"https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",items:[
  passport("Check validity for the intended stay and the current country-specific six-month-rule exemption list."),
  item("DS-160 confirmation","Complete a separate application for each traveller and retain its barcode confirmation."),
  item("Visa fee receipt","Retain receipt when payment is required before interview."),
  item("Visa photograph","Upload a compliant photo to DS-160; bring a printed photo if upload fails."),
  item("Purpose, funding and return ties","Additional evidence may be requested: tourism plans, ability to pay and ties to India. Invitation or affidavit of support is not mandatory.",false)]},
 {country:"Canada",source:"https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html",items:[
  passport("Upload identity/travel-document evidence required by the IRCC portal."),
  item("IRCC application and personalized checklist","Complete the visitor application; the portal checklist and India visa-office instructions determine required uploads."),
  item("Financial and travel evidence","Provide funds and travel-purpose evidence requested by the personalized checklist.",false),
  item("Minor travel authorization","Supply parental authorization and custody/relationship evidence where applicable.",false,{travellerType:"MINOR"}),
  item("Biometrics instruction and appointment","Follow IRCC instructions if biometrics are required; do not assume every traveller needs new biometrics.",false)]},
 {country:"Australia",source:"https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas",items:[
  passport("Provide passport identity evidence requested in ImmiAccount."),
  item("Subclass 600 offshore application checklist","Use Tourist stream (apply outside Australia). Attach the ImmiAccount document list; staff must check the current individual requirements."),
  item("Additional ImmiAccount evidence","Collect financial, tourism, return-ties, minor-consent or health evidence only as applicable to the current official checklist.",false)]},
 {country:"United Arab Emirates",source:"https://gdrfad.gov.ae/en/services/f9e586fe-0642-11ec-0320-0050569629e8",scope:"Dubai single-entry tourist visa via accredited tourism sponsor; other emirates and visa routes require separate review.",items:[
  passport("Passport validity must be at least six months."),
  item("Personal photograph","Supply the photograph required by the sponsor's application channel."),
  item("Return or onward ticket","Evidence of travel leaving the UAE."),
  item("UAE medical insurance","Medical insurance valid in the UAE."),
  item("Tourism sponsor application","Confirm the accredited tourism office and its application requirements.")]},
 {country:"Singapore",source:"https://new-delhi.mfa.gov.sg/consular-services/visa-information/",items:[
  passport("At least six months validity on entry."),
  item("Signed Form 14A","Complete and sign the current form; submit through an authorized visa agent."),
  item("Two recent colour photographs","35 x 45 mm, white background, taken within three months; follow ICA photo guidance."),
  item("Letter of introduction — if requested","Form V39A/local contact evidence may be requested case by case.",false),
  item("English translations — if applicable","Translate Hindi documents into English.",false)]},
 {country:"Japan",source:"https://www.in.emb-japan.go.jp/itpr_en/Visa.html",scope:"India tourist application via VFS; confirm jurisdiction and current eVISA eligibility before collection.",items:[
  passport("Collect passport evidence according to the applicable Japan VAC checklist."),
  item("Current Japan VAC tourist checklist","The Embassy directs India applicants to VFS. Attach the current jurisdiction-specific tourist checklist before requesting remaining documents."),
  item("Tourist application and supporting dossier","Collect forms, photo, itinerary and financial evidence in the exact format required by the current VAC checklist.",false)]},
 {country:"Germany",source:"https://india.diplo.de/in-en/2674158-2674158",items:[
  passport("Issued within ten years; valid three months after return; two blank pages. Include identity/address copies."),
  item("VIDEX and declarations","Signed form with barcodes; truthfulness and medical-insurance declarations."),
  item("Biometric photograph","35 x 45 mm, white background, within six months."),
  item("Tour plan and accommodation","Cover letter, itinerary, flight reservation and accommodation for every destination."),
  item("Schengen medical insurance","Whole stay/all Schengen states; minimum EUR 30,000; approved Indian insurer."),
  item("Economic status evidence","Three months bank statements. Employed: payslips, contract, leave, two years ITR/Form 16. Self-employed: registration/GST, tax evidence. Student: enrolment/NOC. Retired: pension/income."),
  item("Sponsorship and civil status — if applicable","Sponsor identity, funds and relationship; relevant civil-status documents.",false),
  item("Minor documents and consent","Birth certificate, parent passport copies, both signatures; notarized consent/custody and parent visas where applicable.",true,{travellerType:"MINOR"}),
  item("Representative authorization — if applicable","Signed authorization and representative passport copy.",false)]},
 {country:"France",source:"https://www.france-visas.gouv.fr/en/web/france-visas/la-demarche",scope:"Short-stay tourism. France-Visas wizard generates the actual applicant-specific supporting list; confirm India jurisdiction.",items:[
  passport("Original and copy; follow validity and blank-page rules in France-Visas."),
  item("France-Visas form and receipt","Complete the official application and retain its confirmation."),
  item("France-Visas supporting-document list","Generate the list for Indian nationality, India residence and tourism; collect all original/copy documents it specifies."),
  item("Compliant photographs","Follow the photograph specifications in the generated checklist.")]},
 {country:"Switzerland",source:"https://www.schweiz-indien.eda.admin.ch/en/application-schengen-visa-procedure",scope:"Tourism from India; use the tourist PDF linked on the official procedure page, not the business or family-visit checklist.",items:[
  passport("Collect passport and copies according to the current India tourist checklist."),
  item("Swiss India tourist checklist and application","Attach the current tourist PDF from the official procedure page, complete its application and reconcile every required document."),
  item("Travel medical insurance","Minimum EUR 30,000; entire Schengen stay; use an insurer accepted by the Swiss mission."),
  item("Tourist supporting dossier","Collect itinerary, accommodation, funds, applicant-status and minor documents as specified by the current tourist PDF.",false)]}
];
export default templates.map(t => ({country:t.country,visaType:"TOURIST",applicantType:"STANDARD",notes:`Indian passport holders applying from India. Source reviewed 2026-10-13. Collection baseline; conditional items marked optional must be made mandatory in the case when applicable. ${t.scope??""} Recheck before each submission. Source: ${t.source}`,items:[...t.items,review].map((i,n)=>({...i,sortOrder:n+1}))}));
