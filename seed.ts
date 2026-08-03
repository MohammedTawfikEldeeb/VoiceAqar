import { db } from './src/config/db.js';
import { properties } from './src/db/schema.js';

// 1. Egyptian Sample Real Estate Data Generator (50 Items)
function generatePropertiesData() {
  const cities = [
    { name: 'القاهرة الجديدة', districts: ['التجمع الخامس', 'التجمع الأول', 'بيت الوطن'] },
    { name: 'الشيخ زايد', districts: ['وسط زايد', 'زايد الجديدة', 'حي الأشجار'] },
    { name: '6 أكتوبر', districts: ['التوسعات الشمالية', 'الحي المتميز', 'حدائق أكتوبر'] },
    { name: 'العاصمة الإدارية', districts: ['R7', 'R8', 'منطقة المستثمرين'] },
    { name: 'الساحل الشمالي', districts: ['سيدي عبد الرحمن', 'رأس الحكمة'] },
  ];

  const types = ['شقة', 'ڤيلا', 'تاون هاوس', 'توين هاوس', 'دوبلكس', 'بنتهاوس'];
  const compounds = [
    'ماونتن فيو', 'ميفيدا', 'هايد بارك', 'سوديك وست', 'زد', 'سوان ليك', 
    'تاج سيتي', 'إعمار كايرو جيت', 'بادية', 'البوسكو', 'مراسي', 'هاسيندا باي'
  ];

  const features = [
    'فيو ممتاز على بحيرات صناعية ومساحات خضراء',
    'تشطيب الترا سوبر لوكس بالتكييفات والمطبخ',
    'قريبة من الجامعات والمدارس الدولية والمراكز التجارية',
    'بها حمام سباحة خاص وجاردن كبيرة مناسبة للعائلات',
    'في موقع هادئ جداً ومناسب للاستثمار والسكن الراقي'
  ];

  const items = [];

  for (let i = 1; i <= 50; i++) {
    const cityObj = cities[i % cities.length];
    const district = cityObj.districts[i % cityObj.districts.length];
    const type = types[i % types.length];
    const compound = compounds[i % compounds.length];
    const bedrooms = (i % 4) + 1;
    const bathrooms = Math.max(1, bedrooms - 1);
    const area = 70 + (i * 5);
    const isVilla = type.includes('ڤيلا') || type.includes('هاوس');
    const price = area * (isVilla ? 65000 : 45000) + (i * 100000);

    const titleAr = `${type} للبيع في ${compound} - ${district}، ${cityObj.name}`;
    const feature = features[i % features.length];
    const descriptionAr = `${type} فاخرة للبيع بمساحة ${area} متر مربع في كمبوند ${compound} الواقع بـ ${district} (${cityObj.name}). تحتوي على ${bedrooms} غرف نوم و${bathrooms} حمام. ${feature}. الكمبوند يوفر أمن 24 ساعة، جراج، ونادي صحي.`;

    items.push({
      propertyId: `PROP_${String(i).padStart(3, '0')}`,
      titleAr,
      descriptionAr,
      cityAr: cityObj.name,
      districtAr: district,
      compoundName: compound,
      propertyType: type,
      offeringType: 'للبيع',
      price: price.toString(),
      bedrooms,
      bathrooms,
      areaSqm: area,
      furnished: i % 3 === 0,
    });
  }

  return items;
}

// 2. Main Postgres Seeding Function
async function seedPostgres() {
  try {
    console.log('🚀 Starting PostgreSQL Seeding via Drizzle...');

    const seedProperties = generatePropertiesData();

    console.log('🧹 Clearing old data from properties table...');
    await db.delete(properties);

    console.log('💾 Inserting 50 properties into PostgreSQL...');
    await db.insert(properties).values(seedProperties);

    console.log('🎉 Successfully seeded 50 properties into PostgreSQL!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding PostgreSQL:', error);
    process.exit(1);
  }
}

seedPostgres();