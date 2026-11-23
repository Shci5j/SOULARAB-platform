import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";

const storePath = resolve(process.env.PUBLIC_CONFIG_FILE || "./.data/public-config.json");
const defaultConfig = {
  status: "online",
  message: "SOULARAB public platform",
  showAds: true,
  showWithdrawals: true,
  showBooking: true,
  offers: [
    ["الربح من مشاهدة الإعلانات","شاهد الإعلانات المؤهلة واحصل على أرباحك وفق شروط العرض."],
    ["الربح من مشاهدة الفيديوهات","شاهد الفيديوهات المتاحة واستفد من فرص الربح."],
    ["الربح من جمع الاستبيانات","شارك في الاستبيانات المتاحة وسجل أرباحك."],
    ["الربح من المواقع","اكتشف فرص الربح المرتبطة بالمواقع والخدمات الرقمية."],
    ["الربح من بيع الخدمة","قدّم خدماتك عبر المنصة واستفد من فرص البيع."]
  ],
  withdrawals: ["شام كاش في سوريا","سيرياتيل كاش","الحوالات عبر الهرم / الفؤاد"]
};
let configPromise;
let writeQueue = Promise.resolve();

function normalize(value={}) {
  const offers=Array.isArray(value.offers)&&value.offers.length===5
    ? value.offers.map((item,i)=>[String(item?.[0]??defaultConfig.offers[i][0]).slice(0,120),String(item?.[1]??defaultConfig.offers[i][1]).slice(0,500)])
    : defaultConfig.offers;
  const withdrawals=Array.isArray(value.withdrawals)&&value.withdrawals.length>0
    ? value.withdrawals.slice(0,10).map(x=>String(x).slice(0,120))
    : defaultConfig.withdrawals;
  return {
    status:value.status==="maintenance"?"maintenance":"online",
    message:typeof value.message==="string"?value.message.slice(0,500):defaultConfig.message,
    showAds:value.showAds!==false,
    showWithdrawals:value.showWithdrawals!==false,
    showBooking:value.showBooking!==false,
    offers,
    withdrawals
  };
}
async function load() {
  try {
    const parsed=JSON.parse(await readFile(storePath,"utf8"));
    return normalize(parsed);
  } catch(error) {
    if(error.code==="ENOENT") return {...defaultConfig,offers:defaultConfig.offers.map(x=>[...x]),withdrawals:[...defaultConfig.withdrawals]};
    throw error;
  }
}
export async function loadPublicConfig(){configPromise ||= load();return {...(await configPromise),offers:(await configPromise).offers.map(x=>[...x]),withdrawals:[...(await configPromise).withdrawals]};}
export async function updatePublicConfig(nextConfig){
  const next=normalize(nextConfig);
  const task=writeQueue.then(async()=>{
    await loadPublicConfig();
    await mkdir(dirname(storePath),{recursive:true});
    const temporaryPath=storePath+"."+crypto.randomUUID()+".tmp";
    await writeFile(temporaryPath,JSON.stringify(next,null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
    await rename(temporaryPath,storePath);
    configPromise=Promise.resolve(next);
    return {...next};
  });
  writeQueue=task.catch(()=>{});
  return task;
}