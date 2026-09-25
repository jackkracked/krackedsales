import fs from "fs"; import crypto from "crypto"; import { neon } from "@neondatabase/serverless";
// Links every `customers` row to a contact: match an existing local_contact by email, else create a
// LOCAL-ONLY contact (id `cust_<hash>`, source='stripe', NOT pushed to GHL). Sets customers.contact_id
// + local_contacts.is_customer/customer_status. Idempotent + reversible.
for(const l of fs.readFileSync(new URL("../.env.verify",import.meta.url),"utf8").split("\n")){const m=l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(m){let v=m[2].trim().replace(/^["']|["']$/g,"");process.env[m[1]]=v;}}
const sql=neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
const custs=await sql`select id, dedupe_key, email, name, contact_id, status from customers`;
let matched=0, created=0, relinked=0;
for(const c of custs){
  if(c.contact_id){ await sql`update local_contacts set is_customer=true, customer_status=${c.status}, updated_at=now() where id=${c.contact_id}`; relinked++; continue; }
  let contactId=null;
  if(c.email){ const m=await sql`select id from local_contacts where lower(email)=${c.email.toLowerCase()} order by (case when id like 'cust_%' then 1 else 0 end), synced_at desc limit 1`; if(m[0]) contactId=m[0].id; }
  if(contactId){ await sql`update local_contacts set is_customer=true, customer_status=${c.status}, updated_at=now() where id=${contactId}`; matched++; }
  else {
    contactId="cust_"+crypto.createHash("sha1").update(c.dedupe_key).digest("hex").slice(0,24);
    const name=c.name||c.email||"Unknown"; const parts=name.split(/\s+/);
    const first=parts[0]||name, last=parts.slice(1).join(" ")||null;
    const brand=(name.match(/\(([^)]+)\)/)||[])[1]||null;
    await sql`insert into local_contacts (id, first_name, last_name, full_name, email, company_name, source, is_customer, customer_status, synced_at, updated_at)
      values (${contactId}, ${first}, ${last}, ${name}, ${c.email||null}, ${brand}, 'stripe', true, ${c.status}, now(), now())
      on conflict (id) do update set is_customer=true, customer_status=${c.status}, updated_at=now()`;
    created++;
  }
  await sql`update customers set contact_id=${contactId}, updated_at=now() where id=${c.id}`;
}
console.log("matched to existing contact:",matched," created local-only:",created," re-linked:",relinked);
const [v]=await sql`select count(*)::int total, count(contact_id)::int linked from customers`;
console.log("customers:",v.total," now linked to a contact:",v.linked);
const [lc]=await sql`select count(*) filter (where source='stripe' and id like 'cust_%')::int stripe_created, count(*) filter (where is_customer)::int are_customers from local_contacts`;
console.log("local_contacts created for stripe-only:",lc.stripe_created," total flagged is_customer:",lc.are_customers);
