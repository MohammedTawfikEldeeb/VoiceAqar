import { db } from '../src/config/db.js';
import { properties } from '../src/db/schema.js';

async function printProperties() {
  const allProps = await db.select().from(properties);
  console.log(`Fetched ${allProps.length} properties:`);
  for (const p of allProps) {
    console.log(JSON.stringify({
      id: p.propertyId,
      title: p.titleAr,
      city: p.cityAr,
      district: p.districtAr,
      compound: p.compoundName,
      type: p.propertyType,
      price: p.price,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      furnished: p.furnished
    }, null, 2));
  }
  process.exit(0);
}

printProperties().catch(err => {
  console.error(err);
  process.exit(1);
});
