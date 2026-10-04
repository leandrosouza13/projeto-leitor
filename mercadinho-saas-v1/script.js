// 1. Configuração inicial, dados de demonstração e estado da aplicação.
const STORAGE_KEY = "mercadoflow_v1_data";
const DEFAULT_TARGET_MARGIN = 35;
const LOCATION_FIELDS = ["stock","cost","price","min","target","daily"];
const DEFAULT_LOCATIONS = [
  {id:"store-main",name:"Loja principal",type:"store"},
  {id:"warehouse-central",name:"Estoque central",type:"warehouse"}
];

const seedProducts = [
  {id:"1", name:"Coca-Cola 350ml", sku:"7894900011517", category:"Bebidas", supplier:"Distribuidora ABC", cost:4.20, price:6.50, stock:8, min:10, target:30, daily:5},
  {id:"2", name:"Água Mineral 500ml", sku:"7891000000012", category:"Bebidas", supplier:"Águas Brasil", cost:1.10, price:2.50, stock:42, min:20, target:60, daily:7},
  {id:"3", name:"Chocolate 90g", sku:"7891000200033", category:"Doces", supplier:"Atacado Central", cost:3.40, price:5.90, stock:6, min:8, target:20, daily:2},
  {id:"4", name:"Salgadinho 55g", sku:"7891000400044", category:"Snacks", supplier:"Atacado Central", cost:2.80, price:5.00, stock:14, min:10, target:25, daily:3},
  {id:"5", name:"Cerveja lata 350ml", sku:"7891000500055", category:"Bebidas", supplier:"Distribuidora ABC", cost:2.70, price:4.50, stock:5, min:12, target:36, daily:6}
];

function daysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }

let state = loadData();
let currentSection = "dashboard";
let pendingInvoice = null;
let pendingPlanogramImport = null;
let invoiceDestinationId = null;
let dashboardConsolidated = state.settings.dashboardScope==="all";
const listUi={
  products:{query:"",page:0},
  pricing:{query:"",filter:"all",page:0},
  replenishment:{query:"",page:0},
  central:{query:"",page:0},
  historyPrice:{page:0},
  historyStock:{page:0}
};
const LIST_PAGE_SIZE=15;
let productHistoryDetailsOpen=false;

// 2. Persistência local e compatibilidade com dados salvos por versões anteriores.
function loadData(){
  const saved = localStorage.getItem(STORAGE_KEY);
  const data = saved ? JSON.parse(saved) : {
    products:seedProducts,sales:[],invoices:[],purchases:[],costHistory:[],
    priceHistory:[],auditLog:[],transfers:[],locations:DEFAULT_LOCATIONS.map(location=>({...location})),
    settings:{targetMargin:DEFAULT_TARGET_MARGIN,activeLocationId:"store-main"}
  };
  data.products ||= [];
  data.sales ||= [];
  data.invoices ||= [];
  data.purchases ||= [];
  data.costHistory ||= [];
  data.priceHistory ||= [];
  data.auditLog ||= [];
  data.transfers ||= [];
  data.settings ||= {};
  data.settings.targetMargin ??= DEFAULT_TARGET_MARGIN;
  data.settings.centralInventoryEnabled ??= false;
  data.locations ||= DEFAULT_LOCATIONS.map(location=>({...location}));
  if(!data.locations.some(location=>location.id==="store-main")){
    data.locations.unshift({...DEFAULT_LOCATIONS[0]});
  }
  if(!data.locations.some(location=>location.id==="warehouse-central")){
    data.locations.push({...DEFAULT_LOCATIONS[1]});
  }
  data.settings.activeLocationId ||= "store-main";
  if(!data.settings.centralInventoryEnabled&&data.settings.activeLocationId==="warehouse-central"){
    data.settings.activeLocationId="store-main";
  }
  if(!data.locations.some(location=>location.id===data.settings.activeLocationId)){
    data.settings.activeLocationId="store-main";
  }
  data.settings.dashboardScope ||= "location";
  data.products.forEach(product=>{
    const legacyValues=Object.fromEntries(LOCATION_FIELDS.map(field=>[field,Number(product[field]||0)]));
    product.inventoryByLocation ||= {[data.locations.find(location=>location.id==="store-main").id]:legacyValues};
    data.locations.forEach(location=>{
      product.inventoryByLocation[location.id] ||= {
        ...legacyValues,stock:location.id==="store-main"?legacyValues.stock:0
      };
    });
    Object.assign(product,product.inventoryByLocation[data.settings.activeLocationId]);
  });
  data.purchases.forEach(purchase=>{
    purchase.locationId ||= purchase.storeId==="default-store"?"store-main":purchase.storeId||"store-main";
  });
  data.sales.forEach(sale=>{sale.locationId ||= "store-main";});
  data.costHistory.forEach(entry=>{entry.locationId ||= "store-main";});
  data.priceHistory.forEach(entry=>{entry.locationId ||= "store-main";});
  data.auditLog.forEach(entry=>{entry.locationId ||= "store-main";});
  data.invoices.forEach(invoice=>{
    const purchase=data.purchases.find(entry=>entry.accessKey===invoice.accessKey);
    invoice.locationId ||= purchase?.locationId||"store-main";
  });
  if(!saved) saveData(data);
  return data;
}
// Persiste os valores da tela no saldo do local que está selecionado.
function syncActiveLocation(data){
  const locationId=data.settings?.activeLocationId;
  if(!locationId) return;
  data.products.forEach(product=>{
    product.inventoryByLocation ||= {};
    data.locations.forEach(location=>{
      product.inventoryByLocation[location.id] ||= {
        stock:0,cost:0,price:0,min:0,target:0,daily:0
      };
    });
    const inventory=product.inventoryByLocation[locationId]||{};
    LOCATION_FIELDS.forEach(field=>{inventory[field]=Number(product[field]||0);});
    product.inventoryByLocation[locationId]=inventory;
  });
}
function saveData(data=state){
  syncActiveLocation(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const content = document.getElementById("app-content");
const title = document.getElementById("page-title");
const pageEyebrow = document.getElementById("page-eyebrow");

// Prepara as células para que tabelas possam ser lidas como cartões em telas estreitas.
function labelResponsiveTables(root=content){
  root.querySelectorAll(".table-wrap table").forEach(table=>{
    const headers=[...table.querySelectorAll("thead th")].map(header=>header.textContent.trim());
    table.querySelectorAll("tbody tr").forEach(row=>{
      [...row.cells].forEach((cell,index)=>{
        if(cell.colSpan===1&&headers[index]) cell.dataset.label=headers[index];
      });
    });
  });
}
new MutationObserver(()=>labelResponsiveTables()).observe(content,{childList:true,subtree:true});

document.querySelectorAll(".nav-item").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    navigateTo(btn.dataset.section);
  });
});
document.getElementById("brand-home").addEventListener("click",()=>navigateTo("dashboard"));
const storeSwitcherToggle=document.getElementById("store-switcher-toggle");
const storeSwitcherMenu=document.getElementById("store-switcher-menu");
storeSwitcherToggle.addEventListener("click",event=>{
  event.stopPropagation();
  if(storeSwitcherToggle.disabled) return;
  storeSwitcherMenu.hidden=!storeSwitcherMenu.hidden;
  storeSwitcherToggle.setAttribute("aria-expanded",String(!storeSwitcherMenu.hidden));
});
storeSwitcherMenu.addEventListener("click",event=>{
  const option=event.target.closest("[data-store-id]");
  if(!option) return;
  event.stopPropagation();
  storeSwitcherMenu.hidden=true;
  storeSwitcherToggle.setAttribute("aria-expanded","false");
  setActiveLocation(option.dataset.storeId);
});
document.addEventListener("click",event=>{
  if(event.target.closest(".store-switcher")) return;
  storeSwitcherMenu.hidden=true;
  storeSwitcherToggle.setAttribute("aria-expanded","false");
});
document.getElementById("location-switcher").addEventListener("change",event=>{
  setActiveLocation(event.target.value);
});
document.getElementById("quick-product").onclick=()=>openProductModal();

// 3. Acesso aos dados, formatação e cálculos comuns a várias telas.
function money(v){ return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function productById(id){ return state.products.find(p=>p.id===id); }
function activeLocationId(){ return state.settings.activeLocationId; }
function activeLocation(){ return state.locations.find(location=>location.id===activeLocationId())||state.locations[0]; }
function locationById(id){ return state.locations.find(location=>location.id===id); }
function centralInventoryEnabled(){ return state.settings.centralInventoryEnabled===true; }
function productInventory(product,locationId=activeLocationId()){
  product.inventoryByLocation ||= {};
  return product.inventoryByLocation[locationId] ||= {
    stock:0,cost:Number(product.cost||0),price:Number(product.price||0),
    min:Number(product.min||0),target:Number(product.target||0),daily:Number(product.daily||0)
  };
}
function applyLocationView(locationId){
  state.products.forEach(product=>Object.assign(product,productInventory(product,locationId)));
}
function setActiveLocation(locationId){
  if(!locationById(locationId)||(locationById(locationId).type==="warehouse"&&!centralInventoryEnabled())||locationId===activeLocationId()) return;
  saveData();
  state.settings.activeLocationId=locationId;
  if(!pendingInvoice) invoiceDestinationId=locationId;
  applyLocationView(locationId);
  saveData();
  render();
}
function getNeed(p){ return Math.max(0, Number(p.target)-Number(p.stock)); }
function status(p){
  if(p.stock<=0) return ["danger","Sem estoque"];
  if(p.stock<p.min) return ["danger","Crítico"];
  if(p.stock<=p.min*1.25) return ["warning","Atenção"];
  return ["ok","Saudável"];
}
function totalStockValue(locationIds=[activeLocationId()]){
  return state.products.reduce((sum,product)=>sum+locationIds.reduce((value,locationId)=>{
    const inventory=productInventory(product,locationId);
    return value+Number(inventory.stock||0)*Number(inventory.cost||0);
  },0),0);
}
function potentialPurchase(){
  return state.products.reduce((s,p)=>s+getNeed(p)*p.cost,0);
}
function pricingSettings(locationId=activeLocationId()){
  state.settings.pricingByLocation ||= {};
  return state.settings.pricingByLocation[locationId] ||= {
    targetMargin:Number(state.settings.targetMargin)||DEFAULT_TARGET_MARGIN,
    salesTaxRate:0,salesFeeRate:0,lossRate:0,configured:false
  };
}
function targetMargin(locationId=activeLocationId()){
  return Number(pricingSettings(locationId).targetMargin)||DEFAULT_TARGET_MARGIN;
}
function currentMargin(product,locationId=activeLocationId()){
  const inventory=productInventory(product,locationId);
  const settings=pricingSettings(locationId);
  if(!settings.configured||inventory.price<=0) return null;
  return (inventory.price*(1-(settings.salesTaxRate+settings.salesFeeRate)/100)
    -inventory.cost*(1+settings.lossRate/100))/inventory.price*100;
}
function recommendedPrice(product,locationId=activeLocationId()){
  const inventory=productInventory(product,locationId);
  return recommendedPriceForCost(inventory.cost,locationId);
}
function recommendedPriceForCost(cost,locationId=activeLocationId()){
  const settings=pricingSettings(locationId);
  if(!settings.configured||cost<=0) return 0;
  const denominator=1-(settings.targetMargin+settings.salesTaxRate+settings.salesFeeRate)/100;
  if(denominator<=0) return 0;
  const calculated=cost*(1+settings.lossRate/100)/denominator;
  return Math.ceil((calculated-1e-9)*100)/100;
}
function needsPriceReview(product,locationId=activeLocationId()){
  const inventory=productInventory(product,locationId);
  const margin=currentMargin(product,locationId);
  return pricingSettings(locationId).configured&&inventory.cost>0
    &&(margin===null||margin+0.005<targetMargin(locationId));
}
function renderPricingSettingsPanel(id="pricing-rules-form"){
  const settings=pricingSettings();
  return `<section class="card panel pricing-rules-panel">
    <div class="panel-head"><div><h3>Regras de preço · ${esc(activeLocation().name)}</h3><small>Configure ao começar e ajuste quando seus custos mudarem. Aplicadas somente à unidade selecionada.</small></div>
      <span class="badge ${settings.configured?"ok":"warning"}">${settings.configured?"Configurado":"Configuração necessária"}</span></div>
    <form id="${id}" class="pricing-rules-form">
      <label>Margem desejada (% do preço de venda)<input name="targetMargin" type="number" min="1" max="90" step="0.1" value="${settings.targetMargin}" required></label>
      <label>Impostos sobre a venda (%)<input name="salesTaxRate" type="number" min="0" max="100" step="0.01" value="${settings.salesTaxRate}" required></label>
      <label>Taxas sobre a venda (%)<input name="salesFeeRate" type="number" min="0" max="100" step="0.01" value="${settings.salesFeeRate}" required></label>
      <label>Perdas sobre o custo de compra (%)<input name="lossRate" type="number" min="0" max="100" step="0.01" value="${settings.lossRate}" required></label>
      <button class="btn primary" type="submit">${settings.configured?"Salvar regras":"Configurar preços"}</button>
    </form>
    <p class="product-sub">A recomendação considera perdas sobre o custo e impostos/taxas sobre o preço de venda. Não altera preços sem sua confirmação.</p>
  </section>`;
}
function bindPricingSettingsForm(formId,onSaved){
  const form=document.getElementById(formId);
  if(!form) return;
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(form).entries());
    const settings={
      targetMargin:Number(values.targetMargin),
      salesTaxRate:Number(values.salesTaxRate),
      salesFeeRate:Number(values.salesFeeRate),
      lossRate:Number(values.lossRate),
      configured:true
    };
    if(Object.values(settings).some(value=>typeof value==="number"&&!Number.isFinite(value))
      ||settings.targetMargin<1||settings.targetMargin>90
      ||settings.salesTaxRate<0||settings.salesTaxRate>100
      ||settings.salesFeeRate<0||settings.salesFeeRate>100
      ||settings.lossRate<0||settings.lossRate>100){
      alert("Revise os percentuais: margem entre 1% e 90%; impostos, taxas e perdas entre 0% e 100%.");
      return;
    }
    if(settings.targetMargin+settings.salesTaxRate+settings.salesFeeRate>=100){
      alert("A soma da margem, dos impostos e das taxas deve ser menor que 100% para existir um preço recomendado.");
      return;
    }
    state.settings.pricingByLocation ||= {};
    state.settings.pricingByLocation[activeLocationId()]=settings;
    state.settings.targetMargin=settings.targetMargin;
    saveData();
    onSaved();
  });
}
function fmtDate(v){ return new Date(v+"T12:00:00").toLocaleDateString("pt-BR"); }
function compareRecordedDesc(a,b){
  const dateA=a.recordedAt||`${a.date||""}T00:00:00`;
  const dateB=b.recordedAt||`${b.date||""}T00:00:00`;
  return dateB.localeCompare(dateA);
}
function paginateList(items,key,pageSize=LIST_PAGE_SIZE){
  const ui=listUi[key];
  const pageCount=Math.max(1,Math.ceil(items.length/pageSize));
  ui.page=Math.max(0,Math.min(ui.page,pageCount-1));
  const start=ui.page*pageSize;
  return {items:items.slice(start,start+pageSize),pageCount,start,total:items.length};
}
function renderListPagination(key,pageCount,total){
  if(total<=LIST_PAGE_SIZE) return "";
  const ui=listUi[key];
  return `<div class="list-pagination"><span>${ui.page*LIST_PAGE_SIZE+1}–${Math.min((ui.page+1)*LIST_PAGE_SIZE,total)} de ${total}</span><div><button class="btn small" data-list-page="${key}" data-page-direction="-1" ${ui.page<=0?"disabled":""}>Anterior</button><span>Página ${ui.page+1} de ${pageCount}</span><button class="btn small" data-list-page="${key}" data-page-direction="1" ${ui.page>=pageCount-1?"disabled":""}>Próxima</button></div></div>`;
}
function bindListPagination(root,key,onPage){
  root.querySelectorAll(`[data-list-page="${key}"]`).forEach(button=>{
    button.addEventListener("click",()=>{
      listUi[key].page+=Number(button.dataset.pageDirection);
      onPage();
    });
  });
}
function rerenderListKeepingFocus(renderFunction,event){
  const controls=Array.from(content.querySelectorAll("input[id],select[id],textarea[id]"))
    .filter(control=>control.type!=="file")
    .map(control=>({id:control.id,value:control.value,checked:control.checked,type:control.type}));
  const details=Array.from(content.querySelectorAll("details")).map(detail=>detail.open);
  const focusedId=event.target.id;
  const selectionStart=event.target.selectionStart;
  const selectionEnd=event.target.selectionEnd;
  renderFunction();
  controls.forEach(control=>{
    const element=document.getElementById(control.id);
    if(!element) return;
    if(control.type==="checkbox"||control.type==="radio") element.checked=control.checked;
    else element.value=control.value;
  });
  content.querySelectorAll("details").forEach((detail,index)=>{
    if(details[index]!==undefined) detail.open=details[index];
  });
  const focused=document.getElementById(focusedId);
  if(focused){
    focused.focus();
    if(selectionStart!==null&&selectionEnd!==null&&typeof focused.setSelectionRange==="function"){
      focused.setSelectionRange(selectionStart,selectionEnd);
    }
  }
}

// 4. Navegação e montagem das telas principais.
function render(){
  const titles={precificacao:"Precificação",dashboard:"Visão geral",produtos:"Produtos",compras:"Abastecimento",importar:"Receber compra",lojas:"Lojas",central:"Estoque central",configuracoes:"Configurações"};
  const eyebrows={precificacao:"CUSTOS E MARGENS",dashboard:"PAINEL DA LOJA",produtos:"CATÁLOGO",compras:"PLANEJAMENTO DE ESTOQUE",importar:"RECEBIMENTO DE COMPRAS",lojas:"GESTÃO DE LOJAS",central:"TRANSFERÊNCIA DE ESTOQUE",configuracoes:"REGRAS DA UNIDADE"};
  title.textContent=titles[currentSection] || "Receber compra";
  pageEyebrow.textContent=eyebrows[currentSection] || "PAINEL DA LOJA";
  const locationSelect=document.getElementById("location-switcher");
  const visibleLocations=state.locations.filter(location=>location.type!=="warehouse"||centralInventoryEnabled());
  locationSelect.innerHTML=visibleLocations.map(location=>`<option value="${esc(location.id)}" ${location.id===activeLocationId()?"selected":""}>${esc(location.type==="warehouse"?"Central · "+location.name:location.name)}</option>`).join("");
  document.getElementById("active-location-name").textContent=activeLocation().name;
  const stores=state.locations.filter(location=>location.type==="store");
  storeSwitcherToggle.disabled=stores.length<=1;
  storeSwitcherToggle.title=stores.length>1?"Trocar loja":"Cadastre mais de uma loja para ativar a troca rápida";
  storeSwitcherMenu.innerHTML=stores.map(location=>`<button type="button" class="store-switcher-option" role="menuitem" data-store-id="${esc(location.id)}" aria-current="${location.id===activeLocationId()}">${esc(location.name)}${location.id===activeLocationId()?" · atual":""}</button>`).join("");
  if(stores.length<=1){
    storeSwitcherMenu.hidden=true;
    storeSwitcherToggle.setAttribute("aria-expanded","false");
  }
  document.querySelectorAll(".nav-item").forEach(item=>{
    item.classList.toggle("active",item.dataset.section===currentSection);
  });
  document.querySelector('[data-section="central"]').hidden=!centralInventoryEnabled();
  if(currentSection==="precificacao") renderPricing();
  if(currentSection==="dashboard") renderDashboard();
  if(currentSection==="produtos") renderProducts();
  if(currentSection==="compras") renderPurchases();
  if(currentSection==="importar") renderImport();
  if(currentSection==="lojas") renderLocations();
  if(currentSection==="central") renderCentralInventory();
  if(currentSection==="configuracoes") renderSettings();
}

function renderSettings(){
  const settings=pricingSettings();
  content.innerHTML=`
    <section class="dashboard-intro">
      <div><span class="eyebrow">CONFIGURAÇÕES DA UNIDADE</span><h2>Regras de preço</h2><p>Defina os parâmetros usados nas recomendações de preço para ${esc(activeLocation().name)}. Cada unidade tem suas próprias regras.</p></div>
    </section>
    ${renderPricingSettingsPanel("settings-pricing-rules-form")}
    ${settings.configured?'<div class="info">As alterações feitas aqui passam a valer para os cálculos e recomendações desta unidade.</div>':""}`;
  bindPricingSettingsForm("settings-pricing-rules-form",render);
}

// A tela de precificação compara margens atuais com as recomendações configuradas.
function renderPricing(){
  const review=state.products.filter(needsPriceReview).sort((a,b)=>recommendedPrice(b)-b.price-(recommendedPrice(a)-a.price));
  const pricingQuery=listUi.pricing.query.trim().toLocaleLowerCase("pt-BR");
  const pricingProducts=state.products.filter(product=>{
    const matchesQuery=[product.name,product.sku,product.category].join(" ").toLocaleLowerCase("pt-BR").includes(pricingQuery);
    return matchesQuery&&(listUi.pricing.filter!=="review"||needsPriceReview(product));
  });
  const pricingPage=paginateList(pricingProducts,"pricing");
  const validProducts=state.products.filter(p=>currentMargin(p)!==null);
  const averageMargin=validProducts.length
    ? validProducts.reduce((sum,p)=>sum+currentMargin(p),0)/validProducts.length
    : 0;
  const markupValue=review.reduce((sum,p)=>sum+(recommendedPrice(p)-p.price),0);
  content.innerHTML=`
    <section class="pricing-hero">
      <div class="hero-copy">
        <span class="hero-kicker"><i></i> DECISÕES MAIS CLARAS, MARGEM PROTEGIDA</span>
        <h2>Seu custo mudou.<br><span>Seu preço acompanhou?</span></h2>
        <p>Analise custos, perdas, impostos e taxas para identificar quais preços precisam de atenção.</p>
      </div>
      <div class="pricing-highlight"><strong>${pricingSettings().configured?`${targetMargin()}%`:"Configure sua meta"}</strong><span>Margem desejada · ${esc(activeLocation().name)}</span></div>
      <div class="hero-decoration">%</div>
    </section>
    ${pricingSettings().configured
      ?'<div class="pricing-settings-shortcut"><span>Regras de preço configuradas para esta unidade.</span><button class="btn" onclick="navigateTo(\'configuracoes\')">Editar regras em Configurações</button></div>'
      :renderPricingSettingsPanel()}
    <div class="grid kpis pricing-kpis">
      <div class="card kpi"><div class="label">PRECISAM DE REVISÃO</div><div class="value">${review.length}</div><div class="sub">abaixo da margem desejada</div></div>
      <div class="card kpi"><div class="label">MARGEM MÉDIA ATUAL</div><div class="value">${averageMargin.toFixed(1).replace(".", ",")}%</div><div class="sub">média simples dos produtos com custo</div></div>
      <div class="card kpi"><div class="label">META DE MARGEM</div><div class="value">${pricingSettings().configured?`${targetMargin()}%`:"—"}</div><div class="sub">configurada para sua loja</div></div>
      <div class="card kpi"><div class="label">DIFERENÇA DE PREÇO</div><div class="value">${money(markupValue)}</div><div class="sub">soma dos ajustes sugeridos por unidade</div></div>
    </div>
    <section class="card panel pricing-panel">
      <div class="panel-head pricing-panel-head">
        <div><h3>Recomendações de preço</h3><small>Calculadas para ${esc(activeLocation().name)} a partir do custo de compra cadastrado</small></div>
        ${review.length?`<button class="btn primary" onclick="applyAllRecommendations()">Aplicar todas (${review.length})</button>`:""}
      </div>
      ${pricingSettings().configured?"":'<div class="info planogram-safety">Configure as regras de preço acima para habilitar os cálculos e identificar produtos que precisam de revisão.</div>'}
      ${state.products.length ? `<div class="catalog-filters"><input id="pricing-search" type="search" value="${esc(listUi.pricing.query)}" placeholder="Buscar produto"><select id="pricing-filter"><option value="all" ${listUi.pricing.filter==="all"?"selected":""}>Todos os produtos (${state.products.length})</option><option value="review" ${listUi.pricing.filter==="review"?"selected":""}>Precisam de revisão (${review.length})</option></select></div>
      <div class="table-wrap"><table class="pricing-table"><thead><tr><th>Produto</th><th>Custo de compra</th><th>Preço atual</th><th>Margem atual</th><th>Preço sugerido</th><th>Situação</th><th></th></tr></thead><tbody>
        ${pricingPage.items.map(p=>{
          const margin=currentMargin(p);
          const needsReview=needsPriceReview(p);
          const suggestion=recommendedPrice(p);
          return `<tr>
            <td><span class="product-name">${esc(p.name)}</span><span class="product-sub">${esc(p.category||"Sem categoria")} · ${esc(p.sku||"Sem SKU")}</span></td>
            <td>${money(p.cost)}</td>
            <td>${money(p.price)}</td>
            <td>${!pricingSettings().configured?'<span class="badge muted-badge">Configure regras</span>':margin===null?'<span class="badge danger">Sem preço</span>':`${margin.toFixed(1).replace(".",",")}%`}</td>
            <td><strong class="${needsReview?"suggested-price":""}">${!pricingSettings().configured?"—":p.cost>0?money(suggestion):"Cadastre o custo"}</strong></td>
            <td><span class="badge ${!pricingSettings().configured?"muted-badge":needsReview?"warning":"ok"}">${!pricingSettings().configured?"Aguardando regras":needsReview?"Revisar preço":"Dentro da meta"}</span></td>
            <td>${needsReview?`<button class="btn small" onclick="applyRecommendation('${esc(p.id)}')">Aplicar</button>`:`<button class="btn small" onclick="editProduct('${esc(p.id)}')">Editar</button>`}</td>
          </tr>`;
        }).join("")||'<tr><td colspan="7">Nenhum produto corresponde ao filtro.</td></tr>'}
      </tbody></table></div><div id="pricing-pagination"></div>`:`<div class="empty"><strong>Adicione seus produtos para começar</strong>Informe o custo de compra e o preço atual para receber recomendações.</div>`}
      <div class="info pricing-note"><strong>Como calculamos:</strong> preço sugerido = custo × (1 + perdas) ÷ (1 − margem − impostos − taxas). Impostos e taxas incidem sobre a venda; perdas incidem sobre o custo. A decisão final é sua.</div>
    </section>`;
  const locationCostHistory=state.costHistory.filter(entry=>entry.locationId===activeLocationId());
  const invoiceCostEntries=locationCostHistory.slice().sort(compareRecordedDesc).slice(0,12);
  content.insertAdjacentHTML("beforeend",`
    <details class="card panel pricing-panel invoice-pricing-panel">
      <summary class="details-summary">
        <span><strong>Compras que impactam a precificação</strong><small>${locationCostHistory.length} atualização(ões) de custo · comparação com recomendações atuais</small></span>
        <span class="badge ok">Ver detalhes</span>
      </summary>
      ${invoiceCostEntries.length?`<div class="table-wrap"><table class="pricing-table"><thead><tr><th>Produto relacionado</th><th>Custo anterior</th><th>Custo na NF</th><th>Variação do custo</th><th>Preço atual</th><th>Preço sugerido</th><th>Origem</th></tr></thead><tbody>
        ${invoiceCostEntries.map(entry=>{
          const product=productById(entry.productId);
          if(!product) return "";
          const difference=Number(entry.unitCost)-Number(entry.previousUnitCost||0);
          const percentage=Number(entry.previousUnitCost)>0?difference/Number(entry.previousUnitCost)*100:null;
          const source=`${entry.supplier||"Fornecedor não identificado"}${entry.invoiceNumber?` · NF ${entry.invoiceNumber}`:""} · ${fmtDate(entry.date||entry.recordedAt?.slice(0,10)||daysAgo(0))}`;
          return `<tr>
            <td><span class="product-name">${esc(product.name)}</span><span class="product-sub">${esc(product.sku||"Sem SKU")} · ${esc(product.category||"Sem categoria")}</span></td>
            <td>${money(entry.previousUnitCost)}</td>
            <td><strong>${money(entry.unitCost)}</strong></td>
            <td><span class="badge ${difference>0?"danger":difference<0?"ok":"warning"}">${difference>0?"+":""}${money(difference)}${percentage===null?"":` · ${percentage>0?"+":""}${percentage.toFixed(1).replace(".",",")}%`}</span></td>
            <td>${money(product.price)}</td>
            <td><strong class="${needsPriceReview(product)?"suggested-price":""}">${!pricingSettings().configured?"Configure as regras":product.cost>0?money(recommendedPrice(product)):"Cadastre o custo"}</strong></td>
            <td>${esc(source)}${entry.matchReasons?.length?`<span class="product-sub">${esc(entry.matchReasons.join("; "))}</span>`:""}</td>
          </tr>`;
        }).join("")}
      </tbody></table></div>`:`<div class="empty"><strong>Nenhuma nota atualizou custos ainda</strong>Quando uma compra for confirmada e relacionada a um produto, o custo anterior, o custo da nota e o impacto no preço sugerido aparecerão aqui.</div>`}
      <div class="info pricing-note">A nota atualiza o custo de compra e recalcula a recomendação. O preço de venda não muda sozinho; matches por semelhança precisam da sua confirmação.</div>
    </details>`);
  if(state.products.length){
    const search=document.getElementById("pricing-search");
    const filter=document.getElementById("pricing-filter");
    search.addEventListener("input",event=>{
      listUi.pricing.query=event.target.value;listUi.pricing.page=0;rerenderListKeepingFocus(renderPricing,event);
    });
    filter.addEventListener("change",event=>{
      listUi.pricing.filter=event.target.value;listUi.pricing.page=0;rerenderListKeepingFocus(renderPricing,event);
    });
    document.getElementById("pricing-pagination").innerHTML=renderListPagination("pricing",pricingPage.pageCount,pricingPage.total);
    bindListPagination(document.getElementById("pricing-pagination"),"pricing",renderPricing);
  }
  bindPricingSettingsForm("pricing-rules-form",renderPricing);
}

function applyRecommendation(id){
  const product=productById(id);
  if(!product) return;
  updateSalePrice(product,recommendedPrice(product),"Recomendação de margem");
  saveData();
  render();
}
function applyAllRecommendations(){
  const products=state.products.filter(needsPriceReview);
  if(!products.length) return;
  if(!confirm(`Atualizar o preço de ${products.length} produto(s) para atingir a margem bruta de ${targetMargin()}%?`)) return;
  products.forEach(p=>updateSalePrice(p,recommendedPrice(p),"Recomendação de margem"));
  saveData();
  render();
}
function updateSalePrice(product,newPrice,source){
  const previousPrice=Number(product.price||0);
  if(previousPrice===newPrice) return;
  const previousCost=Number(product.cost||0);
  product.price=newPrice;
  recordPriceChange(product,previousPrice,newPrice,source,{previousCost,newCost:Number(product.cost||0)});
}
function priceMarginAt(price,cost,settings){
  if(!settings.configured||price<=0) return null;
  return (price*(1-(settings.salesTaxRate+settings.salesFeeRate)/100)
    -cost*(1+settings.lossRate/100))/price*100;
}
function createPriceHistoryEntry(product,previousPrice,newPrice,source,{
  locationId=activeLocationId(),date=new Date().toISOString(),previousCost=Number(product.cost||0),
  newCost=Number(product.cost||0),user="Operador local"
}={}){
  const rules={...pricingSettings(locationId)};
  return {
    id:`ph${Date.now()}${Math.random()}`,productId:product.id,locationId,previousPrice,newPrice,
    previousCost,newCost,costAtChange:newCost,
    marginBefore:priceMarginAt(previousPrice,previousCost,rules),
    marginAfter:priceMarginAt(newPrice,newCost,rules),
    pricingRules:rules,date,source,user
  };
}
function recordPriceChange(product,previousPrice,newPrice,source,options={}){
  const change=createPriceHistoryEntry(product,previousPrice,newPrice,source,options);
  state.priceHistory.push(change);
  state.auditLog.push({
    id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:product.id,field:"salePrice",
    previousValue:previousPrice,newValue:newPrice,date:change.date,user:change.user,
    source,locationId:change.locationId
  });
}
function recordStockChange(product,previousStock,newStock,source,locationId=activeLocationId(),date=new Date().toISOString()){
  if(Number(previousStock)===Number(newStock)) return;
  state.auditLog.push({
    id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:product.id,field:"stock",
    previousValue:Number(previousStock),newValue:Number(newStock),date,user:"Operador local",
    source,locationId
  });
}

// O painel calcula indicadores a partir da unidade atual ou da visão consolidada.
function renderDashboard(){
  const locations=dashboardConsolidated
    ?state.locations.filter(location=>location.type==="store"||(centralInventoryEnabled()&&location.type==="warehouse"))
    :[activeLocation()];
  const stockLocations=dashboardConsolidated
    ?locations.filter(location=>location.type==="store")
    :locations;
  const critical=state.products.flatMap(product=>stockLocations.map(location=>{
    const inventory=productInventory(product,location.id);
    return {product,location,inventory,need:Math.max(0,Number(inventory.target)-Number(inventory.stock))};
  })).filter(item=>item.inventory.stock<=item.inventory.min)
    .sort((a,b)=>a.inventory.stock-b.inventory.stock);
  const locationProducts=stockLocations.flatMap(location=>state.products.map(product=>({
    product,locationId:location.id,inventory:productInventory(product,location.id)
  })));
  const priced=locationProducts.filter(item=>item.inventory.cost>0);
  const margins=priced.map(item=>currentMargin(item.product,item.locationId)).filter(value=>value!==null);
  const margin=margins.length?margins.reduce((sum,value)=>sum+value,0)/margins.length:0;
  const priceReviews=locationProducts.filter(item=>needsPriceReview(item.product,item.locationId)).length;
  const healthyCount=locationProducts.filter(item=>item.inventory.stock>0&&item.inventory.stock>=item.inventory.min*1.25).length;
  const healthyPercent=locationProducts.length?Math.round(healthyCount/locationProducts.length*100):0;
  const totalUnits=locationProducts.reduce((sum,item)=>sum+Number(item.inventory.stock||0),0);
  const totalToBuy=locationProducts.reduce((sum,item)=>sum+Math.max(0,item.inventory.target-item.inventory.stock)*item.inventory.cost,0);
  const relevantLocationIds=locations.map(location=>location.id);
  const recentPurchases=state.purchases.filter(purchase=>relevantLocationIds.includes(purchase.locationId))
    .slice()
    .sort((a,b)=>(b.recordedAt||b.entryDate||"").localeCompare(a.recordedAt||a.entryDate||""))
    .slice(0,3);
  content.innerHTML=`
    <section class="dashboard-intro">
      <div>
        <span class="eyebrow">RESUMO OPERACIONAL</span>
        <h2>${dashboardConsolidated?`Visão consolidada ${centralInventoryEnabled()?"de lojas e estoque central":"das lojas"}`:"O que precisa da sua atenção hoje?"}</h2>
        <p>${dashboardConsolidated?"Indicadores somados, com os saldos identificados por unidade.":"Acompanhe o estoque, revise preços e registre as compras da sua loja."}</p>
      </div>
      <div class="dashboard-actions">
        <div class="dashboard-scope" role="group" aria-label="Escopo do dashboard">
          <button class="btn ${dashboardConsolidated?"":"selected"}" onclick="setDashboardScope(false)">Esta unidade</button>
          <button class="btn ${dashboardConsolidated?"selected":""}" onclick="setDashboardScope(true)">Consolidado</button>
        </div>
        <button class="btn" onclick="goPurchase()">Ver abastecimento</button>
        <button class="btn" onclick="goDashboardPlanogram()">Analisar planograma</button>
        <button class="btn primary" onclick="goReceive()">+ Receber compra</button>
      </div>
    </section>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">PRODUTOS NO CATÁLOGO</div><div class="value">${state.products.length}</div><div class="sub">base cadastrada</div></div>
      <div class="card kpi"><div class="label">PREÇOS A REVISAR</div><div class="value">${pricingSettings().configured?priceReviews:"—"}</div><div class="sub">${pricingSettings().configured?`abaixo da margem de ${targetMargin()}%`:"Configure suas regras de preço"}</div></div>
      <div class="card kpi"><div class="label">VALOR EM ESTOQUE</div><div class="value">${money(totalStockValue(relevantLocationIds))}</div><div class="sub">a custo local de compra</div></div>
      <div class="card kpi"><div class="label">COMPRA SUGERIDA</div><div class="value">${money(totalToBuy)}</div><div class="sub">para atingir estoque desejado</div></div>
    </div>
    <div class="grid dashboard-grid">
      <section class="card panel">
        <div class="panel-head"><div><h3>Prioridades de estoque</h3><small>${critical.length} alerta(s) · mostrando até 5</small></div>${critical.length?'<button class="btn small" onclick="goPurchase()">Ver abastecimento completo</button>':""}</div>
        ${critical.length ? `<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Falta para o mínimo</th><th></th></tr></thead><tbody>
        ${critical.slice(0,5).map(item=>`<tr><td><span class="product-name">${esc(item.product.name)}</span><span class="product-sub">${esc(item.location.name)}</span></td><td><span class="badge danger">${item.inventory.stock<=0?"Sem estoque":"Crítico"}</span><span class="product-sub">${item.inventory.stock} un.</span></td><td><strong>${Math.max(0,item.inventory.min-item.inventory.stock)} un.</strong></td><td><button class="btn small" onclick="${item.location.type==="warehouse"?"goCentral()":`goPurchaseForLocation('${esc(item.location.id)}')`}">Resolver</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty"><strong>Estoque sob controle</strong>Nenhum produto abaixo do estoque mínimo nos locais selecionados.</div>`}
      </section>
      <section class="card panel">
        <div class="panel-head"><h3>Saúde do estoque</h3><small>${stockLocations.length} local(is)</small></div>
        <div style="margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:6px"><span>Saldos saudáveis</span><strong>${healthyPercent}%</strong></div>
          <div class="progress"><span style="width:${healthyPercent}%"></span></div>
        </div>
        <div class="dashboard-health-summary">
          <div><strong>${totalUnits.toLocaleString("pt-BR")}</strong><span>unidades em estoque</span></div>
          <div><strong>${pricingSettings().configured?`${margin.toFixed(1).replace(".",",")}%`:"—"}</strong><span>margem estimada média</span></div>
        </div>
        <div class="actions" style="margin-top:16px"><button class="btn primary" onclick="goPricing()">Revisar preços${pricingSettings().configured&&priceReviews?` (${priceReviews})`:""}</button>${centralInventoryEnabled()?'<button class="btn" onclick="goCentral()">Distribuir estoque</button>':""}</div>
      </section>
    </div>`;
  content.insertAdjacentHTML("beforeend",`
    <section class="card panel dashboard-activity">
      <details class="dashboard-details">
      <summary><span><strong>Estoque por unidade</strong><small>${locations.length} unidade(s) · visão detalhada</small></span><button class="btn small" onclick="event.preventDefault();goStores()">Gerir lojas</button></summary>
      <div class="table-wrap"><table><thead><tr><th>Unidade</th><th>Produtos</th><th>Unidades em estoque</th><th>Valor a custo</th></tr></thead><tbody>
        ${locations.map(location=>{
          const units=state.products.reduce((sum,product)=>sum+Number(productInventory(product,location.id).stock||0),0);
          return `<tr><td><strong>${esc(location.name)}</strong>${location.type==="warehouse"?'<span class="product-sub">Estoque central</span>':""}</td><td>${state.products.length}</td><td>${units.toLocaleString("pt-BR")}</td><td>${money(totalStockValue([location.id]))}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      </details>
      <details class="dashboard-details dashboard-purchases-details">
      <summary><span><strong>Compras recentes</strong><small>${state.purchases.filter(purchase=>relevantLocationIds.includes(purchase.locationId)).length} compra(s) · exibindo até 3</small></span><button class="btn small" onclick="event.preventDefault();goReceive()">Abrir recebimento</button></summary>
      ${recentPurchases.length?`<div class="table-wrap"><table><thead><tr><th>Entrada</th><th>Fornecedor</th><th>Nota fiscal</th><th>Itens</th><th>Total</th></tr></thead><tbody>
        ${recentPurchases.map(purchase=>`<tr>
          <td>${purchase.entryDate?fmtDate(purchase.entryDate):"—"}</td>
          <td><span class="product-name">${esc(purchase.supplier||"Fornecedor não identificado")}</span><span class="product-sub">${esc(locationById(purchase.locationId)?.name||"Local removido")}</span></td>
          <td>${esc(purchase.number||"—")} / ${esc(purchase.series||"—")}</td>
          <td>${Array.isArray(purchase.items)?purchase.items.length:0}</td>
          <td><strong>${money(purchase.totalValue)}</strong></td>
        </tr>`).join("")}
      </tbody></table></div>`:`<div class="empty"><strong>Nenhuma compra registrada ainda</strong>Importe uma nota fiscal para atualizar o estoque selecionado.<div class="dashboard-empty-action"><button class="btn primary" onclick="goReceive()">Receber primeira compra</button></div></div>`}
      </details>
    </section>`);
  state.settings.dashboardScope=dashboardConsolidated?"all":"location";
  saveData();
}

// Alterna entre os indicadores de uma unidade e a visão consolidada.
function setDashboardScope(consolidated){
  dashboardConsolidated=Boolean(consolidated);
  renderDashboard();
}

// 5. Cadastro, configuração e remoção de lojas e locais de estoque.
function renderLocations(){
  const locations=state.locations.filter(location=>location.type!=="warehouse"||centralInventoryEnabled())
    .slice().sort((a,b)=>a.type==="warehouse"?-1:b.type==="warehouse"?1:a.name.localeCompare(b.name,"pt-BR"));
  content.innerHTML=`
    <section class="card panel central-setting-panel">
      <div><h3>Estoque central</h3><p>Ative apenas se você mantém mercadorias em um depósito separado para distribuir entre as lojas. Desativado, o central fica oculto e não conta como outra loja.</p></div>
      <label class="setting-toggle"><input id="central-inventory-toggle" type="checkbox" ${centralInventoryEnabled()?"checked":""}><span>${centralInventoryEnabled()?"Ativado":"Desativado"}</span></label>
    </section>
    <section class="card panel location-create-panel">
      <div class="panel-head"><div><h3>Adicionar loja</h3><small>O catálogo é compartilhado; estoque, custo e preço começam separados.</small></div></div>
      <form id="location-form" class="location-form">
        <label>Nome da loja<input id="new-location-name" maxlength="60" required placeholder="Ex.: Filial Centro"></label>
        <button class="btn primary" type="submit">Criar loja</button>
      </form>
    </section>
    <section class="card panel location-list-panel">
      <div class="panel-head"><div><h3>Lojas e locais de estoque</h3><small>Troque o contexto de operação pelo seletor do menu ou selecione uma unidade.</small></div><span class="badge ok">${state.locations.filter(location=>location.type==="store").length} loja(s)</span></div>
      <div class="location-cards">${locations.map(location=>{
        const units=state.products.reduce((sum,product)=>sum+Number(productInventory(product,location.id).stock||0),0);
        const active=location.id===activeLocationId();
        const canDelete=location.type==="store"&&location.id!=="store-main";
        return `<article class="location-card ${active?"is-active":""}">
          <div class="location-card-head"><div><span class="badge ${location.type==="warehouse"?"info-badge":"ok"}">${location.type==="warehouse"?"Estoque central":"Loja"}</span><h3>${esc(location.name)}</h3></div>${active?'<span class="badge ok">Em uso</span>':""}</div>
          <p>${state.products.length} produtos no catálogo · ${units.toLocaleString("pt-BR")} unidades em estoque</p>
          <div class="actions">
            <button class="btn ${active?"":"primary"}" ${active?"disabled":`onclick="setActiveLocation('${esc(location.id)}')"`}>${active?"Local selecionado":"Operar nesta unidade"}</button>
            ${location.type==="store"?`<button class="btn" onclick="renameLocation('${esc(location.id)}')">Renomear</button>`:""}
            ${canDelete?`<button class="btn danger" onclick="deleteLocation('${esc(location.id)}')">Excluir loja</button>`:""}
          </div>
        </article>`;
      }).join("")}</div>
      <div class="info">Excluir uma loja apaga os registros e o estoque daquele local, mas mantém o catálogo compartilhado. A loja principal é fixa.${centralInventoryEnabled()?" O estoque central também é um local fixo; transfira mercadorias na tela “Estoque central”.":""}</div>
    </section>
    <section class="card panel danger-zone">
      <div><h3>Apagar todos os registros</h3><p>Remove produtos, compras, notas fiscais, históricos, transferências e documentos deste navegador. As lojas cadastradas e suas configurações serão mantidas.</p></div>
      <button class="btn danger" onclick="clearAllRecords()">Apagar tudo</button>
    </section>`;
  document.getElementById("central-inventory-toggle").addEventListener("change",event=>{
    setCentralInventoryEnabled(event.target.checked);
  });
  document.getElementById("location-form").addEventListener("submit",event=>{
    event.preventDefault();
    const name=document.getElementById("new-location-name").value.trim();
    if(!name) return;
    if(state.locations.some(location=>location.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))){
      alert("Já existe uma loja ou local com esse nome.");return;
    }
    const id=`store-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    state.locations.push({id,name,type:"store"});
    state.products.forEach(product=>{
      const source=productInventory(product,activeLocation().type==="store"?activeLocationId():"store-main");
      product.inventoryByLocation[id]={
        stock:0,cost:Number(source.cost||0),price:Number(source.price||0),
        min:Number(source.min||0),target:Number(source.target||0),daily:Number(source.daily||0)
      };
    });
    state.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"location",entityId:id,field:"created",previousValue:null,newValue:name,date:new Date().toISOString(),user:"Operador local",source:"Cadastro de loja"});
    saveData();
    render();
  });
}

function setCentralInventoryEnabled(enabled){
  state.settings.centralInventoryEnabled=Boolean(enabled);
  if(!enabled&&activeLocation().type==="warehouse"){
    saveData();
    state.settings.activeLocationId="store-main";
    applyLocationView("store-main");
  }
  saveData();
  render();
}

function renameLocation(locationId){
  const location=locationById(locationId);
  if(!location||location.type==="warehouse") return;
  const name=prompt("Novo nome da loja:",location.name)?.trim();
  if(!name||name===location.name) return;
  if(state.locations.some(other=>other.id!==locationId&&other.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))){
    alert("Já existe uma loja ou local com esse nome.");return;
  }
  const previousName=location.name;
  location.name=name;
  state.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"location",entityId:location.id,field:"name",previousValue:previousName,newValue:name,date:new Date().toISOString(),user:"Operador local",source:"Edição de loja"});
  saveData();
  render();
}

// Remove os dados da unidade escolhida sem excluir o catálogo compartilhado.
async function deleteLocation(locationId){
  const location=locationById(locationId);
  if(!location||location.type!=="store"||location.id==="store-main"){
    alert("A loja principal e o estoque central não podem ser excluídos.");
    return;
  }
  if(!confirm(`Excluir a loja "${location.name}"?\n\nOs registros, históricos e o estoque desta loja serão apagados. O catálogo compartilhado e os dados das outras lojas serão mantidos. Esta ação não pode ser desfeita.`)) return;

  const removedPurchases=state.purchases.filter(purchase=>purchase.locationId===locationId||purchase.storeId===locationId);
  const removedInvoices=state.invoices.filter(invoice=>invoice.locationId===locationId);
  const documentKeys=[...new Set([...removedPurchases,...removedInvoices].map(record=>record.accessKey||record.documentId).filter(Boolean))];
  try{
    await deleteInvoiceDocuments(documentKeys);
  }catch(error){
    alert(error instanceof Error?`Não foi possível excluir os documentos da loja: ${error.message}`:"Não foi possível excluir os documentos da loja.");
    return;
  }

  const activeLocationWillBeRemoved=activeLocationId()===locationId;
  const nextState={
    ...state,
    locations:state.locations.filter(entry=>entry.id!==locationId),
    products:state.products.map(product=>{
      const inventoryByLocation={...product.inventoryByLocation};
      delete inventoryByLocation[locationId];
      const nextProduct={...product,inventoryByLocation};
      if(activeLocationWillBeRemoved){
        const mainInventory=inventoryByLocation["store-main"]||{};
        LOCATION_FIELDS.forEach(field=>{nextProduct[field]=Number(mainInventory[field]||0);});
      }
      return nextProduct;
    }),
    sales:state.sales.filter(sale=>sale.locationId!==locationId),
    purchases:state.purchases.filter(purchase=>purchase.locationId!==locationId&&purchase.storeId!==locationId),
    invoices:state.invoices.filter(invoice=>invoice.locationId!==locationId),
    costHistory:state.costHistory.filter(entry=>entry.locationId!==locationId),
    priceHistory:state.priceHistory.filter(entry=>entry.locationId!==locationId),
    auditLog:state.auditLog.filter(entry=>entry.locationId!==locationId&&entry.targetLocationId!==locationId),
    transfers:state.transfers.filter(transfer=>transfer.fromLocationId!==locationId&&transfer.toLocationId!==locationId),
    settings:{...state.settings,activeLocationId:activeLocationWillBeRemoved?"store-main":activeLocationId()}
  };
  try{
    saveData(nextState);
  }catch(error){
    alert(error instanceof Error?`Não foi possível salvar a exclusão da loja: ${error.message}`:"Não foi possível salvar a exclusão da loja.");
    return;
  }
  state=nextState;
  render();
}

// Apaga os dados operacionais e documentos, preservando lojas e configurações.
async function clearAllRecords(){
  if(!confirm("Apagar todos os produtos e registros de todas as lojas? As lojas cadastradas e suas configurações serão mantidas. Esta ação não pode ser desfeita.")) return;
  if(prompt('Para confirmar, digite "APAGAR TUDO".')!=="APAGAR TUDO") return;

  try{
    await deleteInvoiceDocuments([],true);
  }catch(error){
    alert(error instanceof Error?`Não foi possível apagar os documentos: ${error.message}`:"Não foi possível apagar os documentos.");
    return;
  }

  const clearedState={
    ...state,
    products:[],
    sales:[],
    invoices:[],
    purchases:[],
    costHistory:[],
    priceHistory:[],
    auditLog:[],
    transfers:[]
  };
  try{
    saveData(clearedState);
  }catch(error){
    alert(error instanceof Error?`Os documentos foram removidos, mas não foi possível salvar a limpeza dos registros: ${error.message}`:"Os documentos foram removidos, mas não foi possível salvar a limpeza dos registros.");
    return;
  }
  state=clearedState;
  render();
  alert("Todos os registros e produtos foram apagados. As lojas e configurações foram mantidas.");
}

// 6. Operações opcionais de estoque central e transferências entre unidades.
function renderCentralInventory(){
  if(!centralInventoryEnabled()){
    currentSection="lojas";
    render();
    return;
  }
  const central=state.locations.find(location=>location.type==="warehouse");
  const stores=state.locations.filter(location=>location.type==="store");
  const centralValue=totalStockValue([central.id]);
  const units=state.products.reduce((sum,product)=>sum+Number(productInventory(product,central.id).stock||0),0);
  const transfers=state.transfers.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);
  const centralQuery=listUi.central.query.trim().toLocaleLowerCase("pt-BR");
  const transferableProducts=state.products.filter(product=>productInventory(product,central.id).stock>0);
  const centralProducts=transferableProducts
    .filter(product=>[product.name,product.sku].join(" ").toLocaleLowerCase("pt-BR").includes(centralQuery));
  const centralPage=paginateList(centralProducts,"central");
  content.innerHTML=`
    <section class="dashboard-intro">
      <div><span class="eyebrow">ESTOQUE COMPARTILHADO PARA DISTRIBUIÇÃO</span><h2>Estoque central</h2><p>Transfira quantidades para uma loja sem alterar o custo, o preço ou os outros saldos.</p></div>
      <div class="dashboard-actions"><button class="btn" onclick="goStores()">Gerir lojas</button><button class="btn primary" onclick="goReceive()">Receber compra no central</button></div>
    </section>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">UNIDADES NO CENTRAL</div><div class="value">${units.toLocaleString("pt-BR")}</div><div class="sub">disponíveis para distribuição</div></div>
      <div class="card kpi"><div class="label">VALOR DO CENTRAL</div><div class="value">${money(centralValue)}</div><div class="sub">a custo de aquisição local</div></div>
      <div class="card kpi"><div class="label">LOJAS CADASTRADAS</div><div class="value">${stores.length}</div><div class="sub">destinos possíveis</div></div>
      <div class="card kpi"><div class="label">TRANSFERÊNCIAS</div><div class="value">${state.transfers.length}</div><div class="sub">movimentações registradas</div></div>
    </div>
    <section class="card panel central-stock-panel">
      <div class="panel-head"><div><h3>Distribuir mercadorias</h3><small>${centralProducts.length} produto(s) disponíveis · itens sem saldo ficam ocultos</small></div></div>
      ${transferableProducts.length||state.products.length?`<div class="catalog-filters"><input id="central-product-search" type="search" value="${esc(listUi.central.query)}" placeholder="Buscar produto disponível"></div>${centralPage.total?`<div class="table-wrap"><table class="central-stock-table"><thead><tr><th>Produto</th><th>Saldo central</th><th>Destino</th><th>Quantidade</th><th></th></tr></thead><tbody>
        ${centralPage.items.map(product=>{
          const inventory=productInventory(product,central.id);
          return `<tr><td><span class="product-name">${esc(product.name)}</span><span class="product-sub">${esc(product.sku||"Sem SKU")}</span></td><td><strong>${Number(inventory.stock||0).toLocaleString("pt-BR",{maximumFractionDigits:3})}</strong></td><td><select id="transfer-destination-${esc(product.id)}" aria-label="Loja de destino para ${esc(product.name)}">${stores.map(store=>`<option value="${esc(store.id)}">${esc(store.name)}</option>`).join("")}</select></td><td><input id="transfer-quantity-${esc(product.id)}" type="number" min="0.001" max="${Math.max(0,inventory.stock)}" step="0.001" value="${inventory.stock>0?1:""}" aria-label="Quantidade para ${esc(product.name)}" ${inventory.stock>0&&stores.length?"":"disabled"}></td><td><button class="btn small primary" onclick="transferCentralStock('${esc(product.id)}')" ${inventory.stock>0&&stores.length?"":"disabled"}>Transferir</button></td></tr>`;
        }).join("")}
      </tbody></table></div><div id="central-pagination"></div>`:`<div class="empty"><strong>${centralQuery?"Nenhum produto encontrado":"Sem produtos disponíveis para transferência"}</strong>${centralQuery?"Tente outro nome ou código.":"Cadastre produtos e receba mercadorias no estoque central."}</div>`}`:`<div class="empty"><strong>Catálogo vazio</strong>Cadastre um produto ou importe uma nota para começar.</div>`}
    </section>
    <details class="card panel dashboard-activity history-disclosure"><summary class="details-summary"><span><strong>Últimas transferências</strong><small>${state.transfers.length} movimentação(ões) no histórico</small></span><span class="badge muted-badge">Ver histórico</span></summary>
      ${transfers.length?`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Produto</th><th>Quantidade</th><th>Origem</th><th>Destino</th></tr></thead><tbody>
        ${transfers.map(transfer=>`<tr><td>${fmtDate(transfer.date.slice(0,10))}</td><td>${esc(productById(transfer.productId)?.name||"Produto removido")}</td><td>${Number(transfer.quantity).toLocaleString("pt-BR",{maximumFractionDigits:3})}</td><td>${esc(locationById(transfer.fromLocationId)?.name||"Local removido")}</td><td>${esc(locationById(transfer.toLocationId)?.name||"Local removido")}</td></tr>`).join("")}
      </tbody></table></div>`:`<div class="empty"><strong>Nenhuma transferência registrada</strong>As movimentações feitas nesta tela aparecerão aqui.</div>`}
    </details>`;
  if(transferableProducts.length||state.products.length){
    document.getElementById("central-product-search").addEventListener("input",event=>{
      listUi.central.query=event.target.value;listUi.central.page=0;rerenderListKeepingFocus(renderCentralInventory,event);
    });
    const pagination=document.getElementById("central-pagination");
    if(pagination){
      pagination.innerHTML=renderListPagination("central",centralPage.pageCount,centralPage.total);
      bindListPagination(pagination,"central",renderCentralInventory);
    }
  }
}

// Atualiza as duas pontas da transferência e registra sua trilha de auditoria.
function transferCentralStock(productId){
  const central=state.locations.find(location=>location.type==="warehouse");
  const product=productById(productId);
  const quantity=Number(document.getElementById(`transfer-quantity-${productId}`)?.value);
  const destinationId=document.getElementById(`transfer-destination-${productId}`)?.value;
  const destination=locationById(destinationId);
  if(!product||!destination||destination.type!=="store"||!Number.isFinite(quantity)||quantity<=0){
    alert("Escolha uma loja e informe uma quantidade maior que zero.");return;
  }
  const sourceInventory=productInventory(product,central.id);
  if(quantity>sourceInventory.stock){alert(`Saldo insuficiente no estoque central. Disponível: ${sourceInventory.stock} un.`);return;}
  const destinationInventory=productInventory(product,destination.id);
  const previousCentralStock=sourceInventory.stock;
  const previousDestinationStock=destinationInventory.stock;
  sourceInventory.stock=Number((sourceInventory.stock-quantity).toFixed(3));
  destinationInventory.stock=Number((destinationInventory.stock+quantity).toFixed(3));
  if(activeLocationId()===central.id) product.stock=sourceInventory.stock;
  else if(activeLocationId()===destination.id) product.stock=destinationInventory.stock;
  const date=new Date().toISOString();
  state.transfers.push({id:`t${Date.now()}${Math.random()}`,productId,fromLocationId:central.id,toLocationId:destination.id,quantity,date,user:"Operador local"});
  state.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"inventory",entityId:productId,field:"transfer",previousValue:previousCentralStock,newValue:sourceInventory.stock,date,user:"Operador local",source:`Transferência para ${destination.name}`,locationId:central.id,targetLocationId:destination.id});
  recordStockChange(product,previousCentralStock,sourceInventory.stock,`Transferência para ${destination.name}`,central.id,date);
  recordStockChange(product,previousDestinationStock,destinationInventory.stock,`Transferência recebida do estoque central`,destination.id,date);
  saveData();
  renderCentralInventory();
}

// 7. Catálogo e planejamento de abastecimento.
function renderProducts(){
  content.innerHTML=`
    <div class="toolbar">
      <input class="search" id="product-search" value="${esc(listUi.products.query)}" placeholder="Buscar produto, SKU/EAN, fornecedor ou categoria...">
      <button class="btn primary" onclick="openProductModal()">+ Novo produto</button>
    </div>
    <section class="card panel">
      <div class="panel-head"><div><h3>Catálogo</h3><small>${state.products.length} produto(s) · informações detalhadas no link de evolução</small></div></div>
      <div class="table-wrap"><table class="product-catalog-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Custo</th><th>Preço</th><th>Estoque</th><th>Ações</th></tr></thead>
      <tbody id="products-body"></tbody></table></div>
      <div id="products-pagination"></div>
    </section>`;
  document.getElementById("product-search").addEventListener("input",event=>{
    listUi.products.query=event.target.value;
    listUi.products.page=0;
    renderProductRows();
  });
  renderProductRows();
}
function renderProductRows(){
  const query=listUi.products.query.trim().toLocaleLowerCase("pt-BR");
  const filtered=state.products.filter(product=>
    [product.name,product.sku,product.category,product.supplier].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const page=paginateList(filtered,"products");
  document.getElementById("products-body").innerHTML=productRows(page.items);
  document.getElementById("products-pagination").innerHTML=renderListPagination("products",page.pageCount,page.total);
  bindListPagination(document.getElementById("products-pagination"),"products",renderProductRows);
}
function productRows(products){
  if(!products.length) return `<tr><td colspan="6"><div class="empty">Nenhum produto encontrado.</div></td></tr>`;
  return products.map(p=>{
    const [cls,label]=status(p);
    return `<tr data-product-row="${esc(p.id)}">
      <td><span class="product-name">${esc(p.name)}</span><span class="product-sub">${esc(p.sku||"Sem SKU")} · ${esc(p.supplier||"Sem fornecedor")}</span><button class="product-history-link" onclick="openProductHistory('${esc(p.id)}')">Ver evolução de preço e estoque</button></td>
      <td>${esc(p.category||"—")}</td><td><strong>${money(p.cost)}</strong></td>
      <td>${money(p.price)}</td><td><strong>${p.stock}</strong> / ${p.target}<span class="product-sub badge ${cls}">${label}</span></td>
      <td><div class="actions"><button class="btn small" onclick="editProduct('${esc(p.id)}')">Editar</button><button class="btn small" onclick="deleteProduct('${esc(p.id)}')">Excluir</button></div></td>
    </tr>`;
  }).join("");
}
function costMetrics(productId){
  const history=state.costHistory.filter(entry=>entry.productId===productId&&entry.locationId===activeLocationId()).sort(compareRecordedDesc);
  if(!history.length) return {previous:null,lowest:null,highest:null,average:null,lastDate:null};
  const costs=history.map(entry=>Number(entry.unitCost)).filter(Number.isFinite);
  const quantity=history.reduce((sum,entry)=>sum+Number(entry.quantity||0),0);
  const average=quantity?history.reduce((sum,entry)=>sum+Number(entry.unitCost||0)*Number(entry.quantity||0),0)/quantity:null;
  return {previous:history[0].previousUnitCost||null,lowest:Math.min(...costs),highest:Math.max(...costs),average,lastDate:history[0].date};
}
function formatPriceHistoryDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?esc(value||"—"):date.toLocaleString("pt-BR");
}
function productHistoryPoints(product,kind,locationId=activeLocationId()){
  if(kind==="price"){
    const entries=state.priceHistory.filter(entry=>entry.productId===product.id&&entry.locationId===locationId)
      .slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    if(!entries.length) return [];
    return [{date:entries[0].date,value:Number(entries[0].previousPrice),source:"Início do histórico"},
      ...entries.map(entry=>({date:entry.date,value:Number(entry.newPrice),source:entry.source||"Alteração manual"}))]
      .filter(point=>Number.isFinite(point.value));
  }
  const entries=state.auditLog.filter(entry=>entry.entityId===product.id&&entry.field==="stock"&&entry.locationId===locationId
    &&Number.isFinite(Number(entry.newValue)))
    .slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
  if(!entries.length) return [];
  return [{date:entries[0].date,value:Number(entries[0].previousValue),source:"Início do histórico"},
    ...entries.map(entry=>({date:entry.date,value:Number(entry.newValue),source:entry.source||"Movimentação de estoque"}))]
    .filter(point=>Number.isFinite(point.value));
}
function renderProductHistoryChart(points,{title,color,formatter}){
  if(!points.length) return `<section class="product-history-chart"><h3>${esc(title)}</h3><div class="empty"><strong>Ainda não há movimentações registradas</strong>As alterações futuras deste produto aparecerão neste gráfico.</div></section>`;
  const visible=points.slice(-40);
  const values=visible.map(point=>point.value);
  const minimum=Math.min(...values),maximum=Math.max(...values),span=maximum-minimum||1;
  const width=600,height=190,padding={x:34,y:18};
  const coordinates=visible.map((point,index)=>{
    const x=visible.length===1?width/2:padding.x+index/(visible.length-1)*(width-padding.x*2);
    const y=height-padding.y-(point.value-minimum)/span*(height-padding.y*2);
    return {x,y,point};
  });
  const labels=coordinates.map(({x,y,point})=>`<circle cx="${x}" cy="${y}" r="3.5"><title>${esc(formatPriceHistoryDate(point.date))} · ${esc(formatter(point.value))} · ${esc(point.source)}</title></circle>`).join("");
  const polyline=coordinates.map(({x,y})=>`${x},${y}`).join(" ");
  const startDate=visible[0].date?fmtDate(String(visible[0].date).slice(0,10)):"";
  const endDate=visible[visible.length-1].date?fmtDate(String(visible[visible.length-1].date).slice(0,10)):"";
  return `<section class="product-history-chart">
    <div class="product-history-chart-heading"><div><h3>${esc(title)}</h3><span>${visible.length} ponto(s) mais recentes</span></div><strong>${esc(formatter(values[values.length-1]))}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
      <line x1="${padding.x}" y1="${height-padding.y}" x2="${width-padding.x}" y2="${height-padding.y}" class="chart-axis"></line>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${labels}
      <text x="0" y="${padding.y+3}">${esc(formatter(maximum))}</text><text x="0" y="${height-padding.y}">${esc(formatter(minimum))}</text>
      <text x="${padding.x}" y="${height-2}">${esc(startDate)}</text><text x="${width-padding.x}" y="${height-2}" text-anchor="end">${esc(endDate)}</text>
    </svg>
    <div class="product-history-latest"><span>${esc(formatPriceHistoryDate(visible[visible.length-1].date))}</span><span>${esc(visible[visible.length-1].source)}</span></div>
    ${points.length>visible.length?'<small class="product-sub">O gráfico mostra os 40 pontos mais recentes; o histórico completo continua na tabela abaixo.</small>':""}
  </section>`;
}
function renderProductPriceHistoryTable(product,locationId){
  const entries=state.priceHistory.filter(entry=>entry.productId===product.id&&entry.locationId===locationId)
    .slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  if(!entries.length) return `<div class="empty"><strong>Nenhuma alteração de preço registrada</strong>O preço atual é ${money(productInventory(product,locationId).price)}. Próximas mudanças serão guardadas aqui.</div>`;
  const page=paginateList(entries,"historyPrice");
  return `<div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Anterior</th><th>Novo</th><th>Custo</th><th>Margem estimada</th><th>Origem</th></tr></thead><tbody>
    ${page.items.map(entry=>`<tr><td>${formatPriceHistoryDate(entry.date)}</td><td>${money(entry.previousPrice)}</td><td><strong>${money(entry.newPrice)}</strong></td><td>${entry.costAtChange===undefined?"—":money(entry.costAtChange)}</td><td>${entry.marginAfter===undefined||entry.marginAfter===null?"—":`${Number(entry.marginAfter).toFixed(1).replace(".",",")}%`}</td><td>${esc(entry.source||"Alteração manual")}</td></tr>`).join("")}
  </tbody></table></div><div id="history-price-pagination">${renderListPagination("historyPrice",page.pageCount,page.total)}</div>`;
}
function renderProductStockHistoryTable(product,locationId){
  const entries=state.auditLog.filter(entry=>entry.entityId===product.id&&entry.field==="stock"&&entry.locationId===locationId)
    .slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.id).localeCompare(String(a.id)));
  if(!entries.length) return `<div class="empty"><strong>Sem histórico de movimentação de estoque</strong>Movimentações feitas após esta atualização serão registradas e exibidas aqui.</div>`;
  const page=paginateList(entries,"historyStock");
  return `<div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Estoque anterior</th><th>Novo estoque</th><th>Variação</th><th>Origem</th></tr></thead><tbody>
    ${page.items.map(entry=>`<tr><td>${formatPriceHistoryDate(entry.date)}</td><td>${Number(entry.previousValue).toLocaleString("pt-BR")}</td><td><strong>${Number(entry.newValue).toLocaleString("pt-BR")}</strong></td><td>${Number(entry.newValue)-Number(entry.previousValue)>0?"+":""}${(Number(entry.newValue)-Number(entry.previousValue)).toLocaleString("pt-BR")}</td><td>${esc(entry.source||"Movimentação de estoque")}</td></tr>`).join("")}
  </tbody></table></div><div id="history-stock-pagination">${renderListPagination("historyStock",page.pageCount,page.total)}</div>`;
}
function renderProductHistory(product,locationId=activeLocationId()){
  const inventory=productInventory(product,locationId);
  const pricePoints=productHistoryPoints(product,"price",locationId);
  const stockPoints=productHistoryPoints(product,"stock",locationId);
  return `<div class="product-history-summary"><span><small>Preço atual</small><strong>${money(inventory.price)}</strong></span><span><small>Custo atual</small><strong>${money(inventory.cost)}</strong></span><span><small>Estoque atual</small><strong>${Number(inventory.stock).toLocaleString("pt-BR")}</strong></span><span><small>Unidade</small><strong>${esc(locationById(locationId)?.name||"Unidade")}</strong></span></div>
    ${renderProductHistoryChart(pricePoints,{title:"Evolução do preço",color:"#176b45",formatter:money})}
    ${renderProductHistoryChart(stockPoints,{title:"Evolução do estoque",color:"#4776c5",formatter:value=>`${Number(value).toLocaleString("pt-BR")} un.`})}
    <details class="product-history-details" ${productHistoryDetailsOpen?"open":""}><summary>Ver alterações detalhadas</summary><h3>Preços</h3>${renderProductPriceHistoryTable(product,locationId)}<h3>Movimentações de estoque</h3>${renderProductStockHistoryTable(product,locationId)}</details>
    <p class="product-history-note">Históricos anteriores à ativação desses registros podem não incluir todas as movimentações passadas. Os dados permanecem salvos neste navegador.</p>`;
}
function openProductHistory(productId){
  const product=productById(productId);
  if(!product) return;
  listUi.historyPrice.page=0;listUi.historyStock.page=0;productHistoryDetailsOpen=false;
  document.getElementById("product-history-title").textContent=`Evolução · ${product.name}`;
  document.getElementById("product-history-content").innerHTML=renderProductHistory(product);
  document.getElementById("product-history-modal").classList.remove("hidden");
  bindProductHistoryPagination(product);
}
function bindProductHistoryPagination(product){
  const root=document.getElementById("product-history-content");
  [["history-price-pagination","historyPrice"],["history-stock-pagination","historyStock"]].forEach(([id,key])=>{
    const pagination=root.querySelector(`#${id}`);
    if(pagination) bindListPagination(pagination,key,()=>{
      productHistoryDetailsOpen=true;
      root.innerHTML=renderProductHistory(product);
      bindProductHistoryPagination(product);
    });
  });
}
function closeProductHistory(){
  document.getElementById("product-history-modal").classList.add("hidden");
}

function renderPurchases(){
  if(activeLocation().type==="warehouse"){
    content.innerHTML=`<section class="card panel"><div class="empty"><strong>Abastecimento é planejado por loja</strong>O estoque central pode ser distribuído para as unidades; selecione uma loja ou abra a tela de estoque central.<div class="dashboard-empty-action"><button class="btn primary" onclick="goCentral()">Distribuir estoque</button> <button class="btn" onclick="goStores()">Selecionar loja</button></div></div></section>`;
    return;
  }
  const items=state.products.filter(p=>getNeed(p)>0).sort((a,b)=>getNeed(b)-getNeed(a));
  const totalQty=items.reduce((s,p)=>s+getNeed(p),0);
  const query=listUi.replenishment.query.trim().toLocaleLowerCase("pt-BR");
  const filteredItems=items.filter(product=>[product.name,product.sku,product.supplier].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const page=paginateList(filteredItems,"replenishment");
  content.innerHTML=`
    <div class="grid kpis">
      <div class="card kpi"><div class="label">ITENS PARA COMPRAR</div><div class="value">${items.length}</div><div class="sub">produtos abaixo do desejado</div></div>
      <div class="card kpi"><div class="label">QUANTIDADE SUGERIDA</div><div class="value">${totalQty}</div><div class="sub">unidades</div></div>
      <div class="card kpi"><div class="label">CUSTO ESTIMADO</div><div class="value">${money(potentialPurchase())}</div><div class="sub">estimativa de compra</div></div>
      <div class="card kpi"><div class="label">PRIORIDADE</div><div class="value">${state.products.filter(p=>p.stock<=0).length}</div><div class="sub">itens sem estoque</div></div>
    </div>
    <section class="card panel" style="margin-top:18px">
      <div class="panel-head"><div><h3>Lista de abastecimento</h3><small>Ordenada pelas maiores necessidades · ${items.length} item(ns)</small></div><button class="btn" onclick="copyPurchase()">Copiar lista completa</button></div>
      ${items.length ? `<div class="catalog-filters"><input id="replenishment-search" type="search" value="${esc(listUi.replenishment.query)}" placeholder="Buscar produto ou fornecedor"></div><div class="table-wrap"><table><thead><tr><th>Prioridade</th><th>Produto</th><th>Estoque</th><th>Comprar</th><th>Custo estimado</th></tr></thead><tbody>
      ${page.items.map(p=>{const pr=p.stock<=0?"Urgente":p.stock<p.min?"Alta":"Normal"; return `<tr><td><span class="badge ${pr==="Urgente"||pr==="Alta"?"danger":"warning"}">${pr}</span></td><td><span class="product-name">${esc(p.name)}</span><span class="product-sub">${esc(p.supplier||"Sem fornecedor")}</span></td><td>${p.stock} / ${p.target}</td><td><strong>${getNeed(p)} un.</strong></td><td>${money(getNeed(p)*p.cost)}</td></tr>`}).join("")}
      </tbody></table></div><div id="replenishment-pagination"></div>` : `<div class="empty"><strong>${query?"Nenhum produto encontrado":"Nenhuma compra sugerida"}</strong>${query?"Tente outro nome ou fornecedor.":"Seu estoque está acima dos níveis definidos."}</div>`}
    </section>`;
  if(items.length){
    document.getElementById("replenishment-search").addEventListener("input",event=>{
      listUi.replenishment.query=event.target.value;listUi.replenishment.page=0;rerenderListKeepingFocus(renderPurchases,event);
    });
    document.getElementById("replenishment-pagination").innerHTML=renderListPagination("replenishment",page.pageCount,page.total);
    bindListPagination(document.getElementById("replenishment-pagination"),"replenishment",renderPurchases);
  }
}
function copyPurchase(){
  const items=state.products.filter(p=>getNeed(p)>0);
  const text=["LISTA DE ABASTECIMENTO — MercadoFlow",...items.map(p=>`${p.name} | ${getNeed(p)} un. | ${money(getNeed(p)*p.cost)}`)].join("\n");
  navigator.clipboard?.writeText(text).then(()=>alert("Lista copiada."));
}

// 8. Importação de arquivos e leitura dos dados da nota fiscal.
function renderPlanogramImportPanel(){
  return `
    <section class="card panel planogram-panel" id="planogram-section">
      <div class="import-box">
        <div style="font-size:30px;margin-bottom:10px">▤</div>
        <h3>Atualizar planograma</h3>
        <p>Importe a versão atual, analise preço por preço com base no custo da unidade selecionada e escolha o que atualizar. As recomendações não alteram o catálogo nem a planilha até sua confirmação.</p>
        ${pricingSettings().configured
          ?'<div class="pricing-settings-shortcut"><span>Regras de preço configuradas para esta unidade.</span><button class="btn small" onclick="navigateTo(\'configuracoes\')">Editar em Configurações</button></div>'
          :`<details class="pricing-rules-disclosure" open>
          <summary>${pricingSettings().configured?"Regras de preço":"Configure as regras de preço para começar"}</summary>
          ${renderPricingSettingsPanel("planogram-pricing-rules-form")}
        </details>`}
        <div class="import-actions">
          <input type="file" id="planogram-file" accept=".xlsx,.xls,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="max-width:330px">
          <button class="btn primary" id="analyze-planogram-btn">Analisar planilha</button>
        </div>
        <div id="planogram-message" class="info">Excel (.xlsx/.xls), CSV/TSV ou exportação do Google Sheets. PDF deve ser convertido para Excel ou CSV. Para Excel, pode ser necessária conexão para carregar a biblioteca de leitura.</div>
        <div id="planogram-preview"></div>
      </div>
    </section>`;
}

function bindPlanogramImportPanel(){
  const button=document.getElementById("analyze-planogram-btn");
  if(!button) return;
  button.onclick=readPlanogramFile;
  bindPricingSettingsForm("planogram-pricing-rules-form",render);
  renderPlanogramPreview();
}

function renderImport(){
  if(!locationById(invoiceDestinationId)) invoiceDestinationId=activeLocationId();
  const visiblePurchases=state.purchases.filter(purchase=>purchase.locationId===activeLocationId());
  const visibleCostHistory=state.costHistory.filter(entry=>entry.locationId===activeLocationId());
  const purchaseLocations=state.locations.filter(location=>location.type!=="warehouse"||centralInventoryEnabled());
  content.innerHTML=`
    <section class="card panel">
      <div class="invoice-import">
        <div class="invoice-heading"><div><div class="eyebrow">RECEBIMENTO INTELIGENTE</div><h2>Registrar uma compra</h2></div><span class="local-badge">Processamento local</span></div>
        <p>Importe o documento da compra, confira os produtos reconhecidos e resolva os possíveis matches ou duplicidades. O catálogo e o histórico só são atualizados depois da sua confirmação.</p>
        <label class="invoice-destination">Destino do estoque
          <select id="invoice-destination">${purchaseLocations.map(location=>`<option value="${esc(location.id)}" ${location.id===invoiceDestinationId?"selected":""}>${esc(location.type==="warehouse"?"Estoque central · "+location.name:location.name)}</option>`).join("")}</select>
          <span class="product-sub">A compra atualiza somente o custo e o estoque do local escolhido.</span>
        </label>
        <div class="import-actions invoice-actions">
          <input type="file" id="invoice-file" accept=".xml,.pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf,application/xml,text/xml">
          <button class="btn primary" id="invoice-read-btn">Ler nota fiscal</button>
        </div>
        <div id="invoice-message" class="info invoice-message">Os arquivos são processados no navegador e não são enviados com a nota para um serviço de OCR. É necessária conexão para carregar as bibliotecas de leitura de PDF e foto. Prefira XML para extração mais confiável.</div>
        <div id="invoice-preview"></div>
      </div>
    </section>
    <details class="card panel cost-history-panel history-disclosure">
      <summary class="details-summary"><span><strong>Histórico de compras e custos</strong><small>${visiblePurchases.length} compra(s) · ${visibleCostHistory.length} atualização(ões) em ${esc(activeLocation().name)}</small></span><span class="badge muted-badge">Ver históricos</span></summary>
      ${renderPurchaseHistory()}
      ${renderCostHistory(visibleCostHistory)}
    </details>
    ${renderPlanogramImportPanel()}
    <details class="card panel csv-import-disclosure">
      <summary class="details-summary"><span><strong>Importação CSV do modelo padrão</strong><small>Importar ou baixar uma lista de produtos</small></span><span class="badge muted-badge">Opção avançada</span></summary>
      <div class="import-box">
        <div style="font-size:30px;margin-bottom:10px">⇩</div>
        <p>Use este formato simples para importar uma lista própria. Para sincronizar o planograma oficial, use a revisão detalhada acima.</p>
        <div class="import-actions">
          <input type="file" id="csv-file" accept=".csv" style="max-width:260px">
          <button class="btn primary" id="import-btn">Importar CSV</button>
          <button class="btn" id="sample-btn">Baixar modelo CSV</button>
        </div>
        <div class="info"><strong>Colunas esperadas:</strong> nome, sku, categoria, fornecedor, custo, preco, estoque, minimo, desejado, venda_dia</div>
      </div>
    </details>`;
  document.getElementById("sample-btn").onclick=downloadSample;
  document.getElementById("import-btn").onclick=importCSV;
  document.getElementById("invoice-read-btn").onclick=readInvoiceFile;
  document.getElementById("invoice-destination").addEventListener("change",event=>{
    invoiceDestinationId=event.target.value;
    renderPendingInvoice();
  });
  renderPendingInvoice();
  bindPlanogramImportPanel();
}

function renderPurchaseHistory(){
  const purchases=state.purchases.filter(purchase=>purchase.locationId===activeLocationId())
    .slice().sort((a,b)=>(b.recordedAt||b.entryDate).localeCompare(a.recordedAt||a.entryDate));
  if(!purchases.length) return `<div class="empty purchase-empty"><strong>Nenhuma compra registrada ainda</strong>As notas confirmadas aparecerão aqui com fornecedor, número, data, valor e documento original.</div>`;
  return `<h4 class="subsection-title">Compras registradas</h4><div class="table-wrap"><table><thead><tr><th>Entrada</th><th>Fornecedor / CNPJ</th><th>NF / Série</th><th>Data de emissão</th><th>Itens</th><th>Total</th><th>Origem / documento</th></tr></thead><tbody>
    ${purchases.slice(0,50).map(purchase=>`<tr><td>${fmtDate(purchase.entryDate)}</td><td>${esc(purchase.supplier||"Fornecedor não identificado")}<span class="product-sub">${esc(formatCnpj(purchase.supplierCnpj)||"CNPJ não identificado")}</span></td><td>${esc(purchase.number||"—")} / ${esc(purchase.series||"—")}</td><td>${fmtDate(purchase.issueDate)}</td><td>${purchase.items.length} <button class="btn small" onclick="togglePurchaseItems('${esc(purchase.id)}')">Ver itens</button></td><td>${money(purchase.totalValue)}</td><td>${esc(purchase.source||"—")} · <button class="btn small" onclick="downloadInvoiceDocument('${esc(purchase.documentId)}')">Ver original</button></td></tr>
    <tr id="purchase-detail-${esc(purchase.id)}" hidden><td colspan="7"><div class="table-wrap"><table><thead><tr><th>Produto na NF</th><th>Produto relacionado</th><th>Código fornecedor</th><th>GTIN</th><th>NCM / CFOP</th><th>Quantidade</th><th>Custo unitário</th><th>Total</th></tr></thead><tbody>
      ${purchase.items.map(item=>`<tr><td>${esc(item.description)}</td><td>${esc(productById(item.productId)?.name||item.productName)}</td><td>${esc(item.supplierCode||"—")}</td><td>${esc(item.gtin||"—")}</td><td>${esc(item.ncm||"—")} / ${esc(item.cfop||"—")}</td><td>${Number(item.quantity).toLocaleString("pt-BR",{maximumFractionDigits:3})} ${esc(item.unit||"")}</td><td>${money(item.unitCost)}</td><td>${money(item.totalCost)}</td></tr>`).join("")}
    </tbody></table></div></td></tr>`).join("")}
  </tbody></table></div>`;
}
function togglePurchaseItems(id){
  const row=document.getElementById(`purchase-detail-${id}`);
  if(row) row.hidden=!row.hidden;
}

function renderCostHistory(locationEntries=state.costHistory.filter(entry=>entry.locationId===activeLocationId())){
  const entries=locationEntries.slice().sort(compareRecordedDesc).slice(0,40);
  if(!entries.length) return `<div class="empty"><strong>O histórico começa na primeira nota confirmada</strong>Cada importação registra custo, quantidade, fornecedor e data, sem apagar os valores anteriores.</div>`;
  const bySupplier=new Map();
  locationEntries.forEach(entry=>{
    const key=`${entry.productId}:${entry.supplierCnpj||entry.supplier||"unknown"}`;
    const group=bySupplier.get(key)||{productName:entry.productName,supplier:entry.supplier,entries:[]};
    group.entries.push(entry);bySupplier.set(key,group);
  });
  return `<h4 class="subsection-title">Últimas entradas de custo</h4><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Custo anterior</th><th>Novo custo</th><th>Variação</th><th>Quantidade</th><th>Fornecedor / nota</th><th>Data</th></tr></thead><tbody>
    ${entries.map(entry=>{
      const previousCost=Number(entry.previousUnitCost)>0?Number(entry.previousUnitCost):null;
      const delta=previousCost ? (entry.unitCost-previousCost)/previousCost*100 : null;
      return `<tr><td><span class="product-name">${esc(productById(entry.productId)?.name||entry.productName||"Produto removido")}</span></td>
        <td>${previousCost?money(previousCost):"—"}</td><td><strong>${money(entry.unitCost)}</strong></td>
        <td>${delta===null?'<span class="product-sub">Primeiro registro</span>':`<span class="badge ${delta>0.005?"danger":delta< -0.005?"ok":"warning"}">${delta>0?"+":""}${delta.toFixed(1).replace(".",",")}%</span>`}</td>
        <td>${Number(entry.quantity).toLocaleString("pt-BR",{maximumFractionDigits:3})} ${esc(entry.unit||"un.")}</td>
        <td>${esc(entry.supplier||"Fornecedor não identificado")}<span class="product-sub">NF ${esc(entry.invoiceNumber||"—")}</span></td>
        <td>${fmtDate(entry.date)}</td></tr>`;
    }).join("")}
  </tbody></table></div>
  <h4 class="subsection-title supplier-cost-title">Comparativo por fornecedor</h4>
  <div class="table-wrap"><table><thead><tr><th>Produto</th><th>Fornecedor</th><th>Último custo</th><th>Última compra</th><th>Menor custo</th><th>Maior custo</th><th>Custo médio ponderado</th></tr></thead><tbody>
    ${[...bySupplier.values()].map(group=>{
      const history=group.entries.slice().sort(compareRecordedDesc);
      const quantity=history.reduce((sum,entry)=>sum+Number(entry.quantity||0),0);
      const average=quantity?history.reduce((sum,entry)=>sum+Number(entry.unitCost||0)*Number(entry.quantity||0),0)/quantity:0;
      const costs=history.map(entry=>Number(entry.unitCost||0));
      return `<tr><td>${esc(group.productName||"Produto")}</td><td>${esc(group.supplier||"Fornecedor não identificado")}</td><td><strong>${money(history[0].unitCost)}</strong></td><td>${fmtDate(history[0].date)}</td><td>${money(Math.min(...costs))}</td><td>${money(Math.max(...costs))}</td><td>${money(average)}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function setInvoiceMessage(message,isError=false){
  const el=document.getElementById("invoice-message");
  if(!el) return;
  el.className=`info invoice-message${isError?" error":""}`;
  el.textContent=message;
}

// Extrai a nota, procura correspondências e prepara a revisão antes de alterar dados.
async function readInvoiceFile(){
  const file=document.getElementById("invoice-file").files[0];
  if(!file){setInvoiceMessage("Selecione um arquivo XML, PDF ou imagem da nota fiscal.",true);return;}
  const button=document.getElementById("invoice-read-btn");
  button.disabled=true;
  try{
    setInvoiceMessage("Lendo a nota fiscal no navegador. Arquivos de foto/PDF podem levar alguns minutos.");
    const invoice=file.name.toLowerCase().endsWith(".xml")||file.type.includes("xml")
      ? parseNfeXml(await file.text())
      : await parseInvoiceDocument(file);
    if(!invoice.items.length) throw new Error("Não foi possível identificar os itens com segurança. Tente o XML original da NF-e; nenhuma alteração foi feita.");
    if(invoice.accessKey&&!isValidNfeKey(invoice.accessKey)) invoice.accessKey="";
    if(!invoice.accessKey&&invoice.source==="xml") throw new Error("O XML não contém uma chave de acesso válida de 44 dígitos.");
    if(invoice.accessKey&&state.invoices.some(saved=>saved.accessKey===invoice.accessKey)) throw new Error(`Esta nota já foi importada (NF ${invoice.number||invoice.accessKey}). Nenhum dado foi alterado.`);
    invoice.items.forEach(item=>{
      const match=findInvoiceProductMatch(item,invoice);
      item.matchType=match.type;
      item.matchConfidence=match.confidence;
      item.candidates=match.candidates;
      item.matchReason=match.reason;
      item.matchId=match.type==="confirmed"?match.productId:"";
      item.validationErrors=validateInvoiceItem(item);
    });
    invoice.document={name:file.name,type:file.type||"application/octet-stream",blob:file};
    pendingInvoice=invoice;
    renderPendingInvoice();
    setInvoiceMessage(`${invoice.items.length} item(ns) extraído(s) da NF ${invoice.number||"sem número"}. Confira a classificação, corrija os dados e resolva todos os itens antes de registrar a compra.${invoice.usesOcr?" Leitura por OCR: confira cuidadosamente os dados extraídos.":""}${invoice.accessKey?"":' Digite a chave de acesso manualmente para habilitar a confirmação.'}`);
  }catch(error){
    pendingInvoice=null;
    renderPendingInvoice();
    setInvoiceMessage(error instanceof Error?error.message:"Falha ao ler a nota fiscal.",true);
  }finally{
    button.disabled=false;
  }
}

// O XML da NF-e é a fonte preferida por conter campos estruturados e chave oficial.
function parseNfeXml(text){
  const xml=new DOMParser().parseFromString(text,"application/xml");
  if(xml.querySelector("parsererror")) throw new Error("O arquivo não é um XML válido.");
  const infNFe=xml.getElementsByTagNameNS("*","infNFe")[0];
  if(!infNFe) throw new Error("O XML não contém uma NF-e válida (infNFe).");
  const value=(root,name)=>root.getElementsByTagNameNS("*",name)[0]?.textContent?.trim()||"";
  const accessKey=(infNFe.getAttribute("Id")||"").replace(/^NFe/i,"")||value(xml,"chNFe");
  const supplierNode=xml.getElementsByTagNameNS("*","emit")[0];
  const issuerName=supplierNode?value(supplierNode,"xNome"):"";
  const invoiceNumber=value(infNFe,"nNF");
  const series=value(infNFe,"serie");
  const supplierCnpj=value(supplierNode||xml,"CNPJ")||value(supplierNode||xml,"CPF");
  const totalValue=xmlNum(value(xml.getElementsByTagNameNS("*","ICMSTot")[0]||xml,"vNF"));
  const issueDate=(value(infNFe,"dhEmi")||value(infNFe,"dEmi")).slice(0,10);
  const details=Array.from(infNFe.getElementsByTagNameNS("*","det"));
  const items=details.map(detail=>{
    const product=detail.getElementsByTagNameNS("*","prod")[0];
    if(!product) return null;
    const quantity=xmlNum(value(product,"qCom"));
    const productTotal=xmlNum(value(product,"vProd"));
    const extraTotal=["vFrete","vSeg","vOutro"].reduce((sum,key)=>sum+xmlNum(value(product,key)),0);
    const discount=xmlNum(value(product,"vDesc"));
    const unitCost=quantity>0?(productTotal+extraTotal-discount)/quantity:xmlNum(value(product,"vUnCom"));
    const gtin=[value(product,"cEAN"),value(product,"cEANTrib")].find(code=>/^\d{8,14}$/.test(code))||"";
    return {lineNumber:detail.getAttribute("nItem")||"",code:value(product,"cProd"),gtin,name:value(product,"xProd"),ncm:value(product,"NCM"),cfop:value(product,"CFOP"),unit:value(product,"uCom"),quantity,unitCost,totalCost:unitCost*quantity};
  }).filter(Boolean);
  return {accessKey,number:invoiceNumber,series,supplierCnpj,supplier:issuerName,totalValue,date:/^\d{4}-\d{2}-\d{2}$/.test(issueDate)?issueDate:daysAgo(0),items,source:"xml"};
}

function loadScript(src,globalName){
  if(window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=src;
    script.onload=()=>window[globalName]?resolve(window[globalName]):reject(new Error("Biblioteca de leitura não carregada."));
    script.onerror=()=>reject(new Error("Não foi possível carregar a biblioteca de leitura. Verifique a conexão e tente novamente."));
    document.head.appendChild(script);
  });
}

// PDFs e imagens usam extração local; OCR pode exigir bibliotecas carregadas sob demanda.
async function parseInvoiceDocument(file){
  let text="";
  let usesOcr=false;
  if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){
    const pdfjs=await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js","pdfjsLib");
    pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
    if(pdf.numPages>20) throw new Error("O PDF tem mais de 20 páginas. Divida a nota em arquivos menores e tente novamente.");
    const pageTexts=[];
    const pagesForOcr=[];
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      const page=await pdf.getPage(pageNumber);
      const textItems=(await page.getTextContent()).items;
      const textLines=[];
      let lastY=null;
      textItems.forEach(item=>{
        const value=(item.str||"").trim();
        if(!value) return;
        const y=Math.round(item.transform?.[5]||0);
        if(lastY===null||Math.abs(y-lastY)>2) textLines.push(value);
        else textLines[textLines.length-1]+=` ${value}`;
        lastY=y;
      });
      const pageText=textLines.join("\n");
      if(pageText.trim().length>50){pageTexts.push(pageText);pagesForOcr.push(page);continue;}
      usesOcr=true;
      pagesForOcr.push(null);
      const viewport=page.getViewport({scale:2});
      const canvas=document.createElement("canvas");
      canvas.width=viewport.width;canvas.height=viewport.height;
      await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
      pageTexts.push(await recognizeInvoiceImage(canvas));
    }
    text=pageTexts.join("\n");
    const extracted=parseInvoiceText(text);
    if(extracted.items.length) return extracted;
    if(pagesForOcr.some(Boolean)){
      usesOcr=true;
      const ocrTexts=[];
      for(let index=0;index<pagesForOcr.length;index++){
        const page=pagesForOcr[index];
        if(!page){ocrTexts.push(pageTexts[index]);continue;}
        const viewport=page.getViewport({scale:2});
        const canvas=document.createElement("canvas");
        canvas.width=viewport.width;canvas.height=viewport.height;
        await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
        ocrTexts.push(await recognizeInvoiceImage(canvas));
      }
      text=ocrTexts.join("\n");
    }
  }else if(file.type.startsWith("image/")||/\.(png|jpe?g|webp|bmp)$/i.test(file.name)){
    usesOcr=true;
    text=await recognizeInvoiceImage(file);
  }else{
    throw new Error("Formato não suportado. Envie XML, PDF, PNG, JPG ou WEBP.");
  }
  const invoice=parseInvoiceText(text);
  invoice.source=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")?"pdf":"photo";
  invoice.usesOcr=usesOcr;
  return invoice;
}

async function recognizeInvoiceImage(image){
  const tesseract=await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js","Tesseract");
  const worker=await tesseract.createWorker("por",1);
  try{
    const result=await worker.recognize(image);
    return result.data.text||"";
  }finally{
    await worker.terminate();
  }
}

function parseInvoiceText(text){
  const keyContext=text.match(/CHAVE\s+DE\s+ACESSO([\s\S]{0,180})/i)?.[1]||"";
  const contextualKeys=keyContext.replace(/\D/g,"").match(/\d{44}/g)||[];
  const allKeys=text.replace(/\D/g,"").match(/\d{44}/g)||[];
  const candidates=[...contextualKeys,...allKeys];
  const accessKey=candidates.find(isValidNfeKey)||"";
  const numberMatch=text.match(/(?:N[º°.]?\s*|N[uú]mero\s*)(\d{1,12})/i);
  const dateMatch=text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const supplierMatch=text.match(/(?:RAZ[AÃ]O SOCIAL|NOME\s*\/?\s*RAZ[AÃ]O SOCIAL)\s*[:\-]?\s*([^\n]+)/i);
  const cnpjMatch=text.match(/CNPJ\s*[:\-]?\s*([\d./\s-]{14,22})/i);
  const seriesMatch=text.match(/S[EÉ]RIE\s*[:\-]?\s*(\d{1,4})/i);
  const totalMatch=text.match(/(?:VALOR TOTAL DA NOTA|VALOR TOTAL)\s*[:R$\s]*([\d.]+,\d{2})/i);
  const rows=text.split(/\r?\n/);
  const items=[];
  const rowPattern=/^\s*(\S+)\s+(.+?)\s+(\d{8})\s+\d{2,3}\s+(\d{4})\s+([A-Z0-9]{1,4})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?:\s|$)/i;
  rows.forEach(line=>{
    const match=line.match(rowPattern);
    if(!match) return;
    const quantity=num(match[6]),unitCost=num(match[7]),totalCost=num(match[8]);
    const productCode=match[1].replace(/[^\w.-]/g,"");
    const name=match[2].trim();
    items.push({lineNumber:String(items.length+1),code:productCode,gtin:/^\d{8,14}$/.test(productCode)?productCode:"",name,ncm:match[3],cfop:match[4],unit:match[5],quantity,unitCost:quantity>0&&totalCost>0?totalCost/quantity:unitCost,totalCost:totalCost||unitCost*quantity});
  });
  const issueDate=dateMatch?`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`:daysAgo(0);
  return {accessKey,number:numberMatch?.[1]||"",series:seriesMatch?.[1]||"",supplierCnpj:cnpjMatch?.[1]?.replace(/\D/g,"")||"",totalValue:totalMatch?num(totalMatch[1]):0,date:issueDate,supplier:supplierMatch?.[1]?.trim()||"",items,source:"photo"};
}

// Valida formato e dígito verificador da chave de acesso de 44 posições.
function isValidNfeKey(key){
  if(!/^\d{44}$/.test(key)) return false;
  let weight=2,sum=0;
  for(let i=42;i>=0;i--){
    sum+=Number(key[i])*weight;
    weight=weight===9?2:weight+1;
  }
  const check=(11-(sum%11))%11;
  return Number(key[43])===(check===10||check===11?0:check);
}

// Procura primeiro códigos confiáveis e depois usa nome apenas para sugerir candidatos.
function findInvoiceProductMatch(item,invoice){
  const gtin=normalizeGtin(item.gtin);
  if(gtin){
    const matches=state.products.filter(product=>productCodes(product).some(code=>normalizeGtin(code)===gtin));
    if(matches.length===1) return {type:"confirmed",productId:matches[0].id,confidence:100,candidates:matches,reason:"GTIN/EAN exato da nota corresponde ao cadastro"};
    if(matches.length>1) return {type:"duplicate",confidence:100,candidates:matches,reason:"GTIN/EAN repetido em mais de um produto"};
  }
  const supplierCode=normalizeProductCode(item.code);
  const supplierCnpj=normalizeGtin(invoice.supplierCnpj);
  if(supplierCode&&supplierCnpj){
    const matches=state.products.filter(product=>normalizeProductCode(product.supplierCodes?.[supplierCnpj])===supplierCode);
    if(matches.length===1) return {type:"confirmed",productId:matches[0].id,confidence:99,candidates:matches,reason:"Código desta nota já relacionado ao CNPJ do fornecedor"};
    if(matches.length>1) return {type:"duplicate",confidence:99,candidates:matches,reason:"Código do fornecedor relacionado a vários produtos"};
  }
  if(supplierCode){
    const normalizedSupplierCode=normalizeProductCode(supplierCode);
    const matches=state.products.filter(product=>
      [product.sku,product.planogramCode,product.planogramId]
        .filter(Boolean).some(code=>normalizeProductCode(code)===normalizedSupplierCode));
    if(matches.length===1){
      return {type:"probable",productId:matches[0].id,confidence:90,candidates:matches,reason:"Código da nota coincide com SKU/ID do catálogo; confirme o produto"};
    }
    if(matches.length>1){
      return {type:"duplicate",confidence:90,candidates:matches,reason:"Código da nota coincide com vários SKUs/IDs; escolha o produto"};
    }
  }
  const name=normalizeProductName(item.name);
  const exact=state.products.filter(product=>normalizeProductName(product.name)===name);
  if(exact.length===1) return {type:"confirmed",productId:exact[0].id,confidence:96,candidates:exact,reason:"Descrição exata e única no catálogo"};
  if(exact.length>1) return {type:"duplicate",confidence:96,candidates:exact,reason:"Descrição corresponde a mais de um produto"};
  const candidates=state.products.map(product=>({product,confidence:productNameSimilarity(item.name,product.name)}))
    .filter(candidate=>candidate.confidence>=0.55)
    .sort((a,b)=>b.confidence-a.confidence);
  if(candidates.length>1){
    return {type:"duplicate",confidence:candidates[0].confidence*100,candidates:candidates.slice(0,5).map(x=>x.product),reason:"Descrições semelhantes; escolha o produto correto"};
  }
  if(candidates.length){
    return {type:"probable",confidence:candidates[0].confidence*100,candidates:candidates.slice(0,5).map(x=>x.product),reason:"Correspondência aproximada pelo nome; confirme antes de atualizar o custo"};
  }
  return {type:item.name?"new":"insufficient",confidence:0,candidates:candidates.slice(0,5).map(x=>x.product),reason:item.name?"Nenhum produto correspondente encontrado":"A nota não trouxe dados suficientes para identificar o produto"};
}
function productCodes(product){return [product.sku,...(product.eans||[])].filter(Boolean);}
function normalizeProductCode(value){return String(value||"").trim().toLocaleUpperCase("pt-BR");}
function normalizeGtin(value){return String(value||"").replace(/\D/g,"");}
function normalizeProductName(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|lt)\b/g,(_,amount)=>`${Number(amount.replace(",","."))*1000}ml`)
    .replace(/(\d+(?:[.,]\d+)?)\s*l\b/g,(_,amount)=>`${Number(amount.replace(",","."))*1000}ml`)
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:gramas?|grs?|gr)\b/g,"$1g")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:kg|quilo?s?)\b/g,(_,amount)=>`${Number(amount.replace(",","."))*1000}g`)
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mililitros?|ml)\b/g,"$1ml")
    .replace(/[^a-z0-9.]/g," ").replace(/\s+/g," ").trim();
}
function productNameSimilarity(first,second){
  const normalizedFirst=normalizeProductName(first),normalizedSecond=normalizeProductName(second);
  if(!normalizedFirst||!normalizedSecond) return 0;
  const firstSize=normalizedFirst.match(/\b\d+(?:\.\d+)?(?:ml|g)\b/g)||[];
  const secondSize=normalizedSecond.match(/\b\d+(?:\.\d+)?(?:ml|g)\b/g)||[];
  if(firstSize.length&&secondSize.length&&firstSize.join("|")!==secondSize.join("|")) return 0;
  const left=new Set(normalizedFirst.split(" ").filter(Boolean));
  const right=new Set(normalizedSecond.split(" ").filter(Boolean));
  const overlap=[...left].filter(token=>right.has(token)).length;
  return left.size+right.size ? 2*overlap/(left.size+right.size) : 0;
}
function validateInvoiceItem(item){
  const issues=[];
  if(!item.name?.trim()) issues.push("Descrição ausente");
  if(!(Number(item.quantity)>0)) issues.push("Quantidade inválida");
  if(!(Number(item.unitCost)>0)) issues.push("Custo unitário ausente ou inválido");
  return issues;
}
function xmlNum(value){
  const parsed=Number(String(value||"0").trim().replace(",","."));
  return Number.isFinite(parsed)?parsed:0;
}

// Exibe o impacto do custo da nota sem alterar automaticamente o preço de venda.
function renderInvoiceCostComparison(item){
  const product=item.matchId&&item.matchId!=="create"&&item.matchId!=="ignore"
    ?productById(item.matchId)
    :item.candidates?.length===1?item.candidates[0]:null;
  if(!product){
    return `<div class="invoice-cost-comparison"><span class="product-sub">${item.matchId==="create"?"Produto novo":"Sem produto confirmado"}</span>
      <strong>${money(item.unitCost)} / un. na nota</strong>
      <span class="product-sub">A recomendação será calculada após relacionar a nota a um produto.</span></div>`;
  }
  const inventory=productInventory(product,invoiceDestinationId||activeLocationId());
  const previousCost=Number(inventory.cost||0),invoiceCost=Number(item.unitCost||0);
  const difference=invoiceCost-previousCost;
  const percentage=previousCost>0?difference/previousCost*100:null;
  const destinationId=invoiceDestinationId||activeLocationId();
  const suggestedCost=invoiceCost>0&&pricingSettings(destinationId).configured
    ?recommendedPriceForCost(invoiceCost,destinationId):0;
  return `<div class="invoice-cost-comparison"><span class="product-name">${esc(product.name)}${item.matchId===product.id?"":" · sugestão"}</span>
    <span class="product-sub">Custo cadastrado: ${money(previousCost)} → custo NF: ${money(invoiceCost)}</span>
    <span class="badge ${difference>0?"danger":difference<0?"ok":"warning"}">${difference>0?"+":""}${money(difference)}${percentage===null?"":` · ${percentage>0?"+":""}${percentage.toFixed(1).replace(".",",")}%`}</span>
    <span class="product-sub">Preço recomendado: ${invoiceCost<=0?"custo inválido":pricingSettings(destinationId).configured?money(suggestedCost):"configure as regras de preço"} · venda atual no destino: ${money(inventory.price)}</span></div>`;
}

// Inclui identificadores e informações do produto na busca manual do recebimento.
function invoiceProductSearchText(product){
  return normalizeProductName([
    product.name,product.sku,product.category,product.supplier,
    ...productCodes(product),...Object.values(product.supplierCodes||{})
  ].filter(Boolean).join(" "));
}
function renderInvoiceProductSearchResults(item,index,query=""){
  const normalizedQuery=normalizeProductName(query);
  const products=normalizedQuery
    ?state.products.filter(product=>invoiceProductSearchText(product).includes(normalizedQuery))
    :item.candidates||[];
  if(!products.length) return `<span class="invoice-search-empty">${normalizedQuery?"Nenhum produto encontrado. Tente outro nome ou código.":"Nenhuma sugestão automática."}</span>`;
  return products.slice(0,30).map(product=>`<button type="button" class="invoice-product-option" data-invoice-product="${esc(product.id)}" data-item-index="${index}">
    <strong>${esc(product.name)}</strong><span>${esc([product.sku&&`SKU ${product.sku}`,product.category,product.supplier].filter(Boolean).join(" · ")||"Sem código ou categoria")}</span>
  </button>`).join("");
}

// A revisão exige decisão explícita para cada item antes de confirmar a compra.
function renderPendingInvoice(){
  const root=document.getElementById("invoice-preview");
  if(!root) return;
  if(!pendingInvoice){root.innerHTML="";return;}
  const alreadyImported=state.invoices.some(invoice=>invoice.accessKey===pendingInvoice.accessKey);
  const pendingItemCount=pendingInvoice.items.filter(item=>item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length)).length;
  root.innerHTML=`
    <div class="invoice-review">
      <div class="invoice-review-head"><div><strong>Conferência da compra</strong><span>${esc(pendingInvoice.supplier||"Fornecedor não identificado")} · CNPJ ${esc(formatCnpj(pendingInvoice.supplierCnpj)||"não identificado")} · NF ${esc(pendingInvoice.number||"—")} · Série ${esc(pendingInvoice.series||"—")} · Emissão ${fmtDate(pendingInvoice.date)}</span><span>Total da nota: ${money(pendingInvoice.totalValue||pendingInvoice.items.reduce((sum,item)=>sum+(Number(item.totalCost)||0),0))} · Documento: ${esc(pendingInvoice.document.name)} · Entrada: ${fmtDate(daysAgo(0))}</span></div><button class="btn ghost small" id="cancel-invoice">Cancelar</button></div>
      ${pendingInvoice.accessKey?"":`<label class="invoice-key-field">Chave de acesso da NF-e (44 dígitos)<input id="invoice-access-key" inputmode="numeric" maxlength="44" value="" placeholder="Digite os 44 dígitos para evitar duplicidade"></label>`}
      <div class="invoice-key-caption">Chave: ${esc(pendingInvoice.accessKey||"aguardando chave válida")}</div>
      <div class="invoice-review-status" role="status">${pendingItemCount?`<strong>${pendingItemCount} item(ns) marcado(s) em vermelho</strong> precisam de correspondência ou correção para liberar a confirmação.`:"Confira os itens e resolva os avisos em vermelho para liberar a confirmação."}</div>
      <div class="match-legend"><span class="badge ok">Confirmado</span><span class="badge warning">Provável · conferir</span><span class="badge danger">Duplicidade · escolher</span><span class="badge info-badge">Novo produto</span><span class="badge muted-badge">Dados insuficientes</span></div>
      <label class="invoice-item-filter">Mostrar itens
        <select id="invoice-item-filter" aria-label="Filtrar itens da nota">
          <option value="all" ${pendingInvoice.showOnlyNeedsAttention?"":"selected"}>Todos os itens (${pendingInvoice.items.length})</option>
          <option value="needs-attention" ${pendingInvoice.showOnlyNeedsAttention?"selected":""}>Precisam de correção (${pendingItemCount})</option>
        </select>
      </label>
      <div class="table-wrap"><table><thead><tr><th>Produto na NF</th><th>Quantidade / unidade</th><th>Custo unitário na NF</th><th>Comparação com catálogo e preço</th><th>Identificação e confirmação</th></tr></thead><tbody>
      ${pendingInvoice.items.map((item,index)=>{
        const needsAttention=item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length);
        return `<tr class="invoice-item-row ${needsAttention?"needs-attention":""}" data-invoice-row="${index}">
        <td><input class="invoice-item-name" data-item-index="${index}" value="${esc(item.name)}" aria-label="Descrição do produto da nota"><span class="product-sub">Cód. ${esc(item.code||"—")} · GTIN ${esc(item.gtin||"—")} · NCM ${esc(item.ncm||"—")} · CFOP ${esc(item.cfop||"—")}</span>${needsAttention?'<span class="invoice-row-warning">⚠ Requer correção</span>':""}</td>
        <td><div class="invoice-numeric-fields"><input class="invoice-item-quantity" data-item-index="${index}" type="number" min="0" step="0.001" value="${Number(item.quantity)||""}" aria-label="Quantidade"><span>${esc(item.unit||"un.")}</span></div></td>
        <td><input class="invoice-item-cost" data-item-index="${index}" type="number" min="0" step="0.0001" value="${Number(item.unitCost)||""}" aria-label="Custo unitário"><span class="product-sub" data-item-total="${index}">Total: ${money(item.totalCost||0)}</span></td>
        <td data-invoice-comparison="${index}">${renderInvoiceCostComparison(item)}</td>
        <td><div class="invoice-product-picker">
          <input class="invoice-match-search" data-item-index="${index}" type="search" value="${esc(item.matchId&&item.matchId!=="create"&&item.matchId!=="ignore"?productById(item.matchId)?.name||"":item.matchSearch||"")}" placeholder="Pesquisar produto por nome, SKU ou código..." aria-label="Pesquisar produto para ${esc(item.name)}" autocomplete="off">
          <div class="invoice-product-results" data-product-results="${index}">${renderInvoiceProductSearchResults(item,index,item.matchSearch||"")}</div>
          <div class="invoice-match-actions">
            <button type="button" class="btn small invoice-create-product" data-item-index="${index}" ${item.matchId==="create"?"disabled":""}>＋ Novo produto</button>
            <button type="button" class="btn small invoice-ignore-product" data-item-index="${index}" ${item.matchId==="ignore"?"disabled":""}>Ignorar item</button>
          </div>
        </div><span class="badge ${matchBadgeClass(item.matchType)}" data-match-status="${index}">${esc(matchLabel(item.matchType))}${item.matchConfidence?` · ${Math.round(item.matchConfidence)}%`:""}</span>
        <span class="product-sub invoice-match-reason">${esc(item.matchReason||"Selecione ou confirme o produto correto")}</span>
        ${item.matchType==="duplicate"?'<span class="product-sub">Confira os resultados antes de criar um item que possa ser duplicado.</span>':""}
        ${item.validationErrors?.length?`<span class="invoice-item-error">${esc(item.validationErrors.join(" · "))}</span>`:""}
        </td></tr>`;
      }).join("")}
      </tbody></table></div>
      <div class="form-actions"><button class="btn primary" id="confirm-invoice" ${alreadyImported?"disabled":""}>Confirmar e atualizar custos/estoque</button></div>
    </div>`;
  document.getElementById("invoice-item-filter").addEventListener("change",event=>{
    pendingInvoice.showOnlyNeedsAttention=event.target.value==="needs-attention";
    applyInvoiceItemFilter();
  });
  root.querySelectorAll(".invoice-match-search").forEach(input=>{
    input.addEventListener("input",event=>{
      const index=Number(event.target.dataset.itemIndex);
      const item=pendingInvoice.items[index];
      item.matchSearch=event.target.value;
      item.matchId="";
      item.matchType="insufficient";
      item.matchConfidence=0;
      item.matchReason="Selecione o produto correto nos resultados";
      const results=root.querySelector(`[data-product-results="${index}"]`);
      if(results) results.innerHTML=renderInvoiceProductSearchResults(item,index,item.matchSearch);
      const comparisonCell=root.querySelector(`[data-invoice-comparison="${index}"]`);
      if(comparisonCell) comparisonCell.innerHTML=renderInvoiceCostComparison(item);
      updateInvoiceConfirmButton();
    });
    input.addEventListener("focus",event=>{
      const item=pendingInvoice.items[Number(event.target.dataset.itemIndex)];
      if(item.matchId&&item.matchId!=="create"&&item.matchId!=="ignore") event.target.select();
    });
  });
  root.querySelectorAll(".invoice-product-option").forEach(button=>{
    button.addEventListener("click",event=>{
      const index=Number(event.currentTarget.dataset.itemIndex);
      const item=pendingInvoice.items[index];
      const product=productById(event.currentTarget.dataset.invoiceProduct);
      if(!product) return;
      item.matchId=product.id;
      item.matchType="confirmed";
      item.matchConfidence=100;
      item.matchReason="Produto escolhido manualmente; o operador confirmou a correspondência";
      item.matchSearch="";
      renderPendingInvoice();
    });
  });
  root.querySelectorAll(".invoice-create-product").forEach(button=>{
    button.addEventListener("click",event=>{
      const item=pendingInvoice.items[Number(event.currentTarget.dataset.itemIndex)];
      const refreshed=findInvoiceProductMatch(item,pendingInvoice);
      if(refreshed.type!=="new"&&!confirm("Há um ou mais produtos semelhantes no catálogo. Tem certeza de que deseja criar outro produto? Isso pode gerar duplicidade.")) return;
      item.matchId="create";
      item.matchType="new";
      item.matchReason=refreshed.type==="new"?"Será adicionado como um novo produto":"Novo produto confirmado manualmente apesar de haver itens semelhantes";
      item.matchSearch="";
      renderPendingInvoice();
    });
  });
  root.querySelectorAll(".invoice-ignore-product").forEach(button=>{
    button.addEventListener("click",event=>{
      const item=pendingInvoice.items[Number(event.currentTarget.dataset.itemIndex)];
      item.matchId="ignore";
      item.matchReason="Item ignorado; não atualizará produto ou custo";
      item.matchSearch="";
      renderPendingInvoice();
    });
  });
  root.querySelectorAll(".invoice-item-name, .invoice-item-quantity, .invoice-item-cost").forEach(input=>{
    input.addEventListener("input",event=>{
      const item=pendingInvoice.items[Number(event.target.dataset.itemIndex)];
      if(event.target.classList.contains("invoice-item-name")) item.name=event.target.value;
      if(event.target.classList.contains("invoice-item-quantity")) item.quantity=Number(event.target.value);
      if(event.target.classList.contains("invoice-item-cost")) item.unitCost=Number(event.target.value);
      item.totalCost=(Number(item.quantity)||0)*(Number(item.unitCost)||0);
      item.validationErrors=validateInvoiceItem(item);
      const totalLabel=document.querySelector(`[data-item-total="${event.target.dataset.itemIndex}"]`);
      if(totalLabel) totalLabel.textContent=`Total: ${money(item.totalCost)}`;
      const comparisonCell=document.querySelector(`[data-invoice-comparison="${event.target.dataset.itemIndex}"]`);
      if(comparisonCell) comparisonCell.innerHTML=renderInvoiceCostComparison(item);
      updateInvoiceConfirmButton();
    });
    input.addEventListener("change",event=>{
      const item=pendingInvoice.items[Number(event.target.dataset.itemIndex)];
      if(event.target.classList.contains("invoice-item-name")){
        item.matchSearch="";
        const match=findInvoiceProductMatch(item,pendingInvoice);
        item.matchType=match.type;
        item.matchConfidence=match.confidence;
        item.candidates=match.candidates;
        item.matchReason=match.reason;
        item.matchId=match.type==="confirmed"?match.productId:"";
        renderPendingInvoice();
      }
    });
  });
  const keyInput=document.getElementById("invoice-access-key");
  if(keyInput) keyInput.addEventListener("input",event=>{
    pendingInvoice.accessKey=event.target.value.replace(/\D/g,"").slice(0,44);
    event.target.value=pendingInvoice.accessKey;
    updateInvoiceConfirmButton();
  });
  updateInvoiceConfirmButton();
  document.getElementById("cancel-invoice").onclick=()=>{pendingInvoice=null;renderPendingInvoice();setInvoiceMessage("Importação cancelada. Nenhum dado foi alterado.");};
  document.getElementById("confirm-invoice").onclick=confirmInvoiceImport;
}

function formatCnpj(value){
  const digits=String(value||"").replace(/\D/g,"");
  if(digits.length===14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5");
  return digits;
}
function matchLabel(type){
  return {confirmed:"Match confirmado",probable:"Match provável",duplicate:"Possível duplicidade",new:"Novo produto",insufficient:"Dados insuficientes"}[type]||"Dados insuficientes";
}
function matchBadgeClass(type){
  return {confirmed:"ok",probable:"warning",duplicate:"danger",new:"info-badge",insufficient:"muted-badge"}[type]||"muted-badge";
}

// Bloqueia a confirmação enquanto houver chave inválida ou item sem resolução.
function updateInvoiceConfirmButton(){
  if(!pendingInvoice) return;
  const confirmButton=document.getElementById("confirm-invoice");
  const keyValid=isValidNfeKey(pendingInvoice.accessKey);
  const duplicate=state.invoices.some(invoice=>invoice.accessKey===pendingInvoice.accessKey);
  const selectedItems=pendingInvoice.items.filter(item=>item.matchId!=="ignore");
  const pendingItemCount=pendingInvoice.items.filter(item=>item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length)).length;
  confirmButton.disabled=duplicate||!keyValid||!selectedItems.length
    ||pendingItemCount>0;
  pendingInvoice.items.forEach((item,index)=>{
    const needsAttention=item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length);
    const row=document.querySelector(`[data-invoice-row="${index}"]`);
    if(row){
      row.classList.toggle("needs-attention",Boolean(needsAttention));
      const warning=row.querySelector(".invoice-row-warning");
      if(needsAttention&&!warning){
        row.querySelector("td")?.insertAdjacentHTML("beforeend",'<span class="invoice-row-warning">⚠ Requer correção</span>');
      }else if(!needsAttention&&warning){
        warning.remove();
      }
      const errorMessage=row.querySelector(".invoice-item-error");
      if(item.validationErrors?.length){
        const target=row.cells[4];
        if(errorMessage) errorMessage.textContent=item.validationErrors.join(" · ");
        else target?.insertAdjacentHTML("beforeend",`<span class="invoice-item-error">${esc(item.validationErrors.join(" · "))}</span>`);
      }else if(errorMessage){
        errorMessage.remove();
      }
    }
    const badge=document.querySelector(`[data-match-status="${index}"]`);
    if(badge){
      badge.className=`badge ${matchBadgeClass(item.matchType)}`;
      badge.textContent=`${matchLabel(item.matchType)}${item.matchConfidence?` · ${Math.round(item.matchConfidence)}%`:""}`;
    }
  });
  const itemFilter=document.getElementById("invoice-item-filter");
  if(itemFilter){
    const pendingOption=itemFilter.querySelector('option[value="needs-attention"]');
    if(pendingOption) pendingOption.textContent=`Precisam de correção (${pendingItemCount})`;
  }
  applyInvoiceItemFilter();
  const caption=document.querySelector(".invoice-key-caption");
  if(caption){
    caption.classList.toggle("needs-attention",!keyValid||duplicate);
    caption.textContent=`Chave: ${pendingInvoice.accessKey||"aguardando chave válida"}${duplicate?" — nota já importada":!keyValid?" — informe uma chave válida de 44 dígitos":""}`;
  }
  const reviewStatus=document.querySelector(".invoice-review-status");
  if(reviewStatus){
    const messages=[];
    if(pendingItemCount) messages.push(`<strong>${pendingItemCount} item(ns) marcado(s) em vermelho</strong> precisam de correspondência ou correção.`);
    if(!selectedItems.length) messages.push("Selecione ao menos um item ou use “Ignorar item”.");
    if(!keyValid) messages.push("Informe uma chave NF-e válida para habilitar a confirmação.");
    if(duplicate) messages.push("Esta nota já foi importada.");
    if(!messages.length) messages.push("Tudo pronto para confirmar a compra.");
    reviewStatus.innerHTML=messages.join(" ");
    reviewStatus.classList.toggle("is-ready",!confirmButton.disabled);
  }
}

// Filtra visualmente os itens sem removê-los da compra nem alterar sua confirmação.
function applyInvoiceItemFilter(){
  if(!pendingInvoice) return;
  const showOnlyNeedsAttention=Boolean(pendingInvoice.showOnlyNeedsAttention);
  pendingInvoice.items.forEach((item,index)=>{
    const row=document.querySelector(`[data-invoice-row="${index}"]`);
    if(!row) return;
    const needsAttention=item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length);
    row.hidden=showOnlyNeedsAttention&&!needsAttention;
  });
}

// Registra compra, produtos, estoque e históricos em conjunto após a revisão.
async function confirmInvoiceImport(){
  if(!pendingInvoice) return;
  const button=document.getElementById("confirm-invoice");
  button.disabled=true;
  if(state.invoices.some(invoice=>invoice.accessKey===pendingInvoice.accessKey)){
    setInvoiceMessage("Esta nota já foi importada. Nenhum dado foi alterado.",true);
    pendingInvoice=null;renderPendingInvoice();return;
  }
  if(pendingInvoice.items.some(item=>item.matchId!=="ignore"&&(!item.matchId||item.validationErrors?.length))||!pendingInvoice.items.some(item=>item.matchId!=="ignore")){
    setInvoiceMessage("Resolva todos os matches e corrija descrição, quantidade e custo. A compra precisa ter ao menos um item válido.",true);
    updateInvoiceConfirmButton();return;
  }
  const invoice=pendingInvoice;
  const groups=new Map();
  invoice.items.filter(item=>item.matchId!=="ignore").forEach(item=>{
    const key=item.matchId==="create"?`new:${invoice.supplierCnpj||""}:${normalizeProductCode(item.gtin||item.code)||normalizeProductName(item.name)}`:`product:${item.matchId}`;
    const existing=groups.get(key);
    if(existing){
      const total=existing.quantity*existing.unitCost+item.quantity*item.unitCost;
      existing.quantity+=item.quantity;
      existing.unitCost=total/existing.quantity;
      existing.code=existing.code||item.code;
      existing.lines.push(item);
    }else groups.set(key,{...item,key,lines:[item]});
  });
  const historyEntries=[];
  const purchaseItems=[];
  const now=new Date().toISOString();
  const destinationId=locationById(invoiceDestinationId)?invoiceDestinationId:activeLocationId();
  const destination=locationById(destinationId);
  const nextState=JSON.parse(JSON.stringify(state));
  for(const item of groups.values()){
    let product=item.matchId==="create"?null:nextState.products.find(candidate=>candidate.id===item.matchId);
    const isNewProduct=!product;
    if(!product){
      product={id:`p${Date.now()}${Math.random()}`,name:item.name,sku:item.gtin||"",eans:item.gtin?[item.gtin]:[],supplierCodes:{},category:item.ncm||"",supplier:invoice.supplier,cost:0,price:0,stock:0,min:0,target:0,daily:0,inventoryByLocation:{}};
      nextState.products.push(product);
    }
    const inventory=productInventory(product,destinationId);
    const previousUnitCost=isNewProduct?0:Number(inventory.cost||0);
    const previousStock=Number(inventory.stock||0);
    inventory.cost=item.unitCost;
    inventory.stock=Number(inventory.stock||0)+item.quantity;
    if(destinationId===nextState.settings.activeLocationId) Object.assign(product,inventory);
    if(invoice.supplier) product.supplier=invoice.supplier;
    if(!Array.isArray(product.eans)) product.eans=[];
    if(item.gtin&&!product.eans.includes(item.gtin)) product.eans.push(item.gtin);
    if(item.gtin&&!product.sku) product.sku=item.gtin;
    product.supplierCodes ||= {};
    if(invoice.supplierCnpj&&item.code) product.supplierCodes[normalizeGtin(invoice.supplierCnpj)]=normalizeProductCode(item.code);
    const entry={id:`h${Date.now()}${Math.random()}`,productId:product.id,productName:product.name,locationId:destinationId,previousUnitCost,unitCost:item.unitCost,quantity:item.quantity,unit:item.unit,date:invoice.date,recordedAt:now,invoiceKey:invoice.accessKey,invoiceNumber:invoice.number,supplier:invoice.supplier,supplierCnpj:invoice.supplierCnpj||"",matchReasons:[...new Set(item.lines.map(line=>line.matchReason).filter(Boolean))]};
    historyEntries.push(entry);
    item.lines.forEach(line=>purchaseItems.push({productId:product.id,productName:product.name,lineNumber:line.lineNumber||"",supplierCode:line.code||"",gtin:line.gtin||"",description:line.name,ncm:line.ncm||"",cfop:line.cfop||"",quantity:Number(line.quantity),unit:line.unit||"",unitCost:Number(line.unitCost),totalCost:Number(line.quantity)*Number(line.unitCost),matchReason:line.matchReason||""}));
    nextState.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:product.id,field:"cost",previousValue:previousUnitCost,newValue:item.unitCost,date:now,user:"Operador local",source:`NF ${invoice.number||invoice.accessKey}`,locationId:destinationId});
    nextState.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:product.id,field:"stock",previousValue:previousStock,newValue:inventory.stock,date:now,user:"Operador local",source:`NF ${invoice.number||invoice.accessKey}`,locationId:destinationId});
  }
  const totalValue=Number(invoice.totalValue)||purchaseItems.reduce((sum,item)=>sum+item.totalCost,0);
  const purchase={id:`b${Date.now()}${Math.random()}`,storeId:destinationId,locationId:destinationId,supplier:invoice.supplier,supplierCnpj:invoice.supplierCnpj||"",number:invoice.number||"",series:invoice.series||"",accessKey:invoice.accessKey,issueDate:invoice.date,entryDate:daysAgo(0),recordedAt:now,totalValue,source:invoice.source,documentId:invoice.accessKey,documentName:invoice.document.name,documentType:invoice.document.type,importedBy:"Operador local",items:purchaseItems};
  nextState.purchases.push(purchase);
  nextState.costHistory.push(...historyEntries);
  nextState.invoices.push({accessKey:invoice.accessKey,number:invoice.number,series:invoice.series||"",date:invoice.date,supplier:invoice.supplier,supplierCnpj:invoice.supplierCnpj||"",itemCount:purchaseItems.length,totalValue,importedAt:now,documentId:invoice.accessKey,locationId:destinationId});
  try{
    await storeInvoiceDocument(invoice.accessKey,invoice.document);
    saveData(nextState);
  }catch(error){
    setInvoiceMessage(error instanceof Error?`Não foi possível registrar a compra com segurança: ${error.message}`:"Falha ao salvar a compra. Nenhuma atualização foi aplicada.",true);
    updateInvoiceConfirmButton();return;
  }
  state=nextState;
  pendingInvoice=null;
  renderImport();
  setInvoiceMessage(`Compra registrada em ${destination.name}: ${purchaseItems.length} item(ns), ${groups.size} produto(s) no catálogo e ${historyEntries.length} atualização(ões) de custo. O preço de venda não foi alterado.`);
}

// 9. Armazenamento dos documentos fiscais no IndexedDB do navegador.
function invoiceDocumentDb(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error("Este navegador não oferece armazenamento seguro para o documento original."));return;}
    const request=indexedDB.open("mercadoflow_documents",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("invoices",{keyPath:"accessKey"});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Falha ao abrir o armazenamento dos documentos."));
  });
}
async function storeInvoiceDocument(accessKey,document){
  const db=await invoiceDocumentDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction("invoices","readwrite");
    transaction.objectStore("invoices").put({accessKey,name:document.name,type:document.type,blob:document.blob,savedAt:new Date().toISOString()});
    transaction.oncomplete=()=>{db.close();resolve();};
    transaction.onerror=()=>{const error=transaction.error||new Error("Falha ao guardar o documento original.");db.close();reject(error);};
    transaction.onabort=()=>{const error=transaction.error||new Error("Armazenamento do documento cancelado.");db.close();reject(error);};
  });
}
// Remove documentos associados à unidade ou todos, quando a operação pede limpeza total.
async function deleteInvoiceDocuments(accessKeys,clearAll=false){
  if(!clearAll&&!accessKeys.length) return;
  const db=await invoiceDocumentDb();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction("invoices","readwrite");
    const documents=transaction.objectStore("invoices");
    if(clearAll) documents.clear();
    else accessKeys.forEach(accessKey=>documents.delete(accessKey));
    let settled=false;
    const finish=(error)=>{
      if(settled) return;
      settled=true;
      db.close();
      if(error) reject(error);
      else resolve();
    };
    transaction.oncomplete=()=>finish();
    transaction.onerror=()=>finish(transaction.error||new Error("Falha ao excluir os documentos."));
    transaction.onabort=()=>finish(transaction.error||new Error("A exclusão dos documentos foi cancelada."));
  });
}
async function downloadInvoiceDocument(accessKey){
  try{
    const db=await invoiceDocumentDb();
    const record=await new Promise((resolve,reject)=>{
      const request=db.transaction("invoices","readonly").objectStore("invoices").get(accessKey);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("Documento original não encontrado."));
    });
    db.close();
    if(!record) throw new Error("Documento original não encontrado neste navegador.");
    const url=URL.createObjectURL(record.blob);
    const link=document.createElement("a");
    link.href=url;link.download=record.name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){alert(error instanceof Error?error.message:"Não foi possível abrir o documento original.");}
}

// 10. Importação tabular de produtos e ferramentas de atualização do planograma.
function downloadSample(){
  const csv="nome,sku,categoria,fornecedor,custo,preco,estoque,minimo,desejado,venda_dia\nBiscoito 100g,789999000001,Mercearia,Fornecedor X,2.10,4.50,12,10,30,2.5\n";
  downloadBlob(csv,"modelo-produtos.csv","text/csv;charset=utf-8");
}
function importCSV(){
  const file=document.getElementById("csv-file").files[0];
  if(!file){alert("Selecione um arquivo CSV.");return;}
  const reader=new FileReader();
  reader.onload=()=>{
    const rows=parseCSV(reader.result);
    let created=0, updated=0;
    rows.forEach(r=>{
      if(!r.nome) return;
      let p=r.sku ? state.products.find(x=>x.sku===r.sku) : null;
      const obj={name:r.nome,sku:r.sku||"",category:r.categoria||"",supplier:r.fornecedor||"",cost:num(r.custo),price:num(r.preco),stock:num(r.estoque),min:num(r.minimo),target:num(r.desejado),daily:num(r.venda_dia)};
      if(p){
        const previousCost=Number(p.cost||0),previousPrice=Number(p.price||0),previousStock=Number(p.stock||0),timestamp=new Date().toISOString();
        Object.assign(p,obj);
        if(previousCost!==obj.cost) state.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:p.id,field:"cost",previousValue:previousCost,newValue:obj.cost,date:timestamp,user:"Operador local",source:"Importação CSV",locationId:activeLocationId()});
        if(previousStock!==obj.stock) recordStockChange(p,previousStock,obj.stock,"Importação CSV",activeLocationId(),timestamp);
        if(previousPrice!==obj.price) recordPriceChange(p,previousPrice,obj.price,"Importação CSV",{date:timestamp,previousCost,newCost:obj.cost});
        updated++;
      }
      else {
        const product={id:"p"+Date.now()+Math.random(),...obj};
        state.products.push(product);
        if(obj.stock>0) recordStockChange(product,0,obj.stock,"Cadastro inicial");
        if(obj.price>0) recordPriceChange(product,0,obj.price,"Cadastro inicial",{previousCost:0,newCost:obj.cost});
        created++;
      }
    });
    saveData(); render();
    alert(`Importação concluída: ${created} criado(s), ${updated} atualizado(s).`);
  };
  reader.readAsText(file,"UTF-8");
}
function parseCSV(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const headers=splitCSV(lines[0]).map(x=>x.trim().toLowerCase());
  return lines.slice(1).map(line=>{
    const vals=splitCSV(line), o={};
    headers.forEach((h,i)=>o[h]=vals[i]??"");
    return o;
  });
}
function splitCSV(line){
  const out=[]; let cur="", quote=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"' && line[i+1]==='"'){cur+='"';i++;continue;}
    if(c==='"'){quote=!quote;continue;}
    if(c==="," && !quote){out.push(cur);cur="";} else cur+=c;
  }
  out.push(cur); return out;
}
function num(v){ return Number(String(v??0).replace(/\./g,"").replace(",", ".")) || 0; }
const PLANOGRAM_FIELDS=[
  {key:"name",label:"Descrição do produto",defaultChecked:true},
  {key:"sku",label:"Código do produto / SKU",defaultChecked:true},
  {key:"ean",label:"Código de barras / EAN",defaultChecked:true},
  {key:"category",label:"Categoria",defaultChecked:true},
  {key:"price",label:"Preço de venda",defaultChecked:true},
  {key:"shelfCapacity",label:"Capacidade de mola",defaultChecked:true},
  {key:"min",label:"Mínimo crítico",defaultChecked:true},
  {key:"target",label:"Nível de par / estoque desejado",defaultChecked:true},
  {key:"stock",label:"Quantidade atual do estoque",defaultChecked:false},
  {key:"planogramType",label:"Tipo do produto",defaultChecked:true}
];
const PLANOGRAM_HEADERS={
  planogramId:["id produto","id do produto","id"],
  sku:["codigo produto","codigo do produto","cod produto","sku"],
  name:["descricao produto","descricao do produto","descricao","nome"],
  category:["categoria produto","categoria do produto","categoria"],
  price:["preco","preco venda","preco de venda"],
  ean:["codigo de barras","ean","gtin","barcode"],
  shelfCapacity:["capacidade mola","capacidade de mola"],
  min:["minimo critico","minimo","estoque minimo"],
  target:["nivel de par","estoque desejado","nivel desejado","desejado"],
  stock:["quant atual","quantidade atual","estoque atual"],
  planogramType:["tipo do produto","tipo produto","tipo"]
};
// Padroniza cabeçalhos variados para reconhecer as colunas da planilha.
function normalizePlanogramHeader(value){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim();
}
function planogramColumnMap(headers){
  const normalized=headers.map(normalizePlanogramHeader),map={};
  Object.entries(PLANOGRAM_HEADERS).forEach(([key,aliases])=>{
    const index=normalized.findIndex(header=>aliases.includes(header));
    if(index>=0) map[key]=index;
  });
  return map;
}
function planogramNumber(value){
  if(value===null||value===undefined||String(value).trim()==="") return null;
  if(typeof value==="number") return Number.isFinite(value)?value:null;
  let text=String(value).trim().replace(/[R$\s]/g,"");
  const comma=text.lastIndexOf(","),dot=text.lastIndexOf(".");
  if(comma>=0&&dot>=0){
    text=comma>dot?text.replace(/\./g,"").replace(",","."):text.replace(/,/g,"");
  }else if(comma>=0){
    text=text.replace(/\./g,"").replace(",",".");
  }else if(/^\d{1,3}(?:\.\d{3})+$/.test(text)){
    text=text.replace(/\./g,"");
  }
  const parsed=Number(text);
  return Number.isFinite(parsed)?parsed:null;
}
function detectDelimitedDelimiter(text){
  const firstLine=String(text).replace(/^\uFEFF/,"").split(/\r?\n/,1)[0]||"";
  return [",",";","\t"].sort((a,b)=>firstLine.split(b).length-firstLine.split(a).length)[0];
}
function parseDelimitedRows(text){
  const firstLine=String(text).split(/\r?\n/,1)[0]||"";
  const delimiter=[",",";","\t"].sort((a,b)=>firstLine.split(b).length-firstLine.split(a).length)[0];
  const rows=[];let row=[],field="",quoted=false;
  const source=String(text).replace(/^\uFEFF/,"");
  for(let i=0;i<source.length;i++){
    const character=source[i];
    if(character==='"'&&source[i+1]==='"'&&quoted){field+='"';i++;continue;}
    if(character==='"'){quoted=!quoted;continue;}
    if(character===delimiter&&!quoted){row.push(field);field="";continue;}
    if((character==="\n"||character==="\r")&&!quoted){
      if(character==="\r"&&source[i+1]==="\n") i++;
      row.push(field);field="";
      if(row.some(cell=>String(cell).trim()!=="")) rows.push(row);
      row=[];
      continue;
    }
    field+=character;
  }
  row.push(field);
  if(row.some(cell=>String(cell).trim()!=="")) rows.push(row);
  return rows;
}
function planogramRecommendedPrice(item,product){
  if(!product||item.status==="conflict"||!pricingSettings().configured) return null;
  const inventory=productInventory(product);
  if(inventory.cost<=0) return null;
  return recommendedPrice(product);
}
function planogramItemsFromGrid(grid){
  let headerIndex=-1,columns={};
  for(let index=0;index<Math.min(grid.length,20);index++){
    const candidate=planogramColumnMap(grid[index]||[]);
    if(candidate.name!==undefined&&(candidate.planogramId!==undefined||candidate.sku!==undefined||candidate.ean!==undefined)){
      headerIndex=index;columns=candidate;break;
    }
  }
  if(headerIndex<0) throw new Error("Não encontrei cabeçalhos reconhecíveis. A planilha precisa ter Descrição e pelo menos um identificador (ID, Código do produto ou Código de barras).");
  const items=[];
  for(let index=headerIndex+1;index<grid.length;index++){
    const cells=grid[index]||[];
    if(!cells.some(cell=>String(cell??"").trim()!=="")) continue;
    const read=(key)=>columns[key]===undefined?"":String(cells[columns[key]]??"").trim();
    const item={
      sourceRow:index+1,
      planogramId:read("planogramId"),
      sku:read("sku"),
      name:read("name"),
      category:read("category"),
      ean:read("ean"),
      planogramType:read("planogramType")
    };
    const errors=[];
    if(!item.name) errors.push("descrição vazia");
    if(!item.planogramId&&!item.sku&&!item.ean) errors.push("sem ID, código ou EAN");
    for(const key of ["price","shelfCapacity","min","target","stock"]){
      const raw=read(key),value=planogramNumber(raw);
      item[key]=value;
      if(raw!==""&&value===null) errors.push(`valor inválido em ${PLANOGRAM_FIELDS.find(field=>field.key===key)?.label||key}`);
      if(value!==null&&value<0) errors.push(`valor negativo em ${PLANOGRAM_FIELDS.find(field=>field.key===key)?.label||key}`);
    }
    item.errors=errors;
    items.push(item);
  }
  const duplicateIndexes=new Map();
  ["planogramId","sku","ean"].forEach(key=>{
    const seen=new Map();
    items.forEach((item,index)=>{
      const value=key==="ean"?normalizeGtin(item[key]):normalizeProductCode(item[key]);
      if(!value) return;
      if(seen.has(value)){
        [seen.get(value),index].forEach(duplicateIndex=>{
          const list=duplicateIndexes.get(duplicateIndex)||[];
          list.push(`identificador ${key} repetido no arquivo`);
          duplicateIndexes.set(duplicateIndex,list);
        });
      }else seen.set(value,index);
    });
  });
  items.forEach((item,index)=>{
    item.errors=[...item.errors,...(duplicateIndexes.get(index)||[])];
    const matches=matchPlanogramProduct(item);
    item.matchProductId=matches.length===1?matches[0].id:null;
    item.status=item.errors.length||matches.length>1?"conflict":matches.length===1?"update":"create";
    if(matches.length>1) item.errors.push("códigos/descrição correspondem a mais de um produto do catálogo");
  });
  return {items,headerIndex,columns};
}
function matchPlanogramProduct(item){
  const idMatches=item.planogramId
    ?state.products.filter(product=>String(product.planogramId||"")===item.planogramId):[];
  const codes=[item.sku,item.ean].filter(Boolean).map(normalizeProductCode);
  const codeMatches=state.products.filter(product=>
    [...productCodes(product),product.planogramCode].filter(Boolean)
      .some(code=>codes.includes(normalizeProductCode(code))));
  let matches=[...new Map([...idMatches,...codeMatches].map(product=>[product.id,product])).values()];
  if(!matches.length){
    const name=normalizeProductName(item.name);
    matches=state.products.filter(product=>normalizeProductName(product.name)===name);
  }
  return matches;
}
// Lê a planilha e constrói uma prévia; nenhuma alteração é aplicada nesta etapa.
async function readPlanogramFile(){
  const file=document.getElementById("planogram-file").files[0];
  const message=document.getElementById("planogram-message");
  const preview=document.getElementById("planogram-preview");
  if(!file){
    pendingPlanogramImport=null;preview.innerHTML="";
    message.className="info planogram-message error";message.textContent="Selecione a planilha do planograma.";return;
  }
  if(file.size>20*1024*1024){
    pendingPlanogramImport=null;preview.innerHTML="";
    message.className="info planogram-message error";message.textContent="O arquivo excede o limite de 20 MB.";return;
  }
  pendingPlanogramImport=null;
  message.className="info planogram-message";
  message.textContent="Lendo planilha e verificando identificadores...";
  preview.innerHTML="";
  try{
    const extension=file.name.split(".").pop().toLowerCase();
    let grid,sheetName="CSV",workbook=null,xlsx=null,delimitedText="",sheetOrigin={row:0,column:0};
    if(extension==="csv"||extension==="tsv"){
      delimitedText=await file.text();
      grid=parseDelimitedRows(delimitedText);
    }else if(extension==="xlsx"||extension==="xls"){
      xlsx=await loadScript("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js","XLSX");
      workbook=xlsx.read(await file.arrayBuffer(),{type:"array",cellDates:false});
      if(!workbook.SheetNames.length) throw new Error("O arquivo Excel não contém abas.");
      sheetName=workbook.SheetNames.includes("Estoque")?"Estoque":workbook.SheetNames[0];
      const worksheet=workbook.Sheets[sheetName];
      if(worksheet["!ref"]){
        const range=xlsx.utils.decode_range(worksheet["!ref"]);
        sheetOrigin={row:range.s.r,column:range.s.c};
      }
      grid=xlsx.utils.sheet_to_json(worksheet,{header:1,defval:"",raw:true});
    }else{
      throw new Error("Formato não suportado. Envie Excel, CSV ou TSV. Para Google Sheets, exporte como Excel/CSV; converta PDF em tabela antes de importar.");
    }
    const parsed=planogramItemsFromGrid(grid);
    const items=parsed.items;
    if(!items.length) throw new Error("A planilha não contém linhas de produtos.");
    const extensionIsDelimited=extension==="csv"||extension==="tsv";
    pendingPlanogramImport={
      fileName:file.name,fileExtension:extension,sheetName,items,page:0,query:"",
      sourceGrid:grid.map(row=>[...row]),headerIndex:parsed.headerIndex,columns:parsed.columns,
      sheetOrigin,
      delimiter:extensionIsDelimited?detectDelimitedDelimiter(delimitedText):",",
      workbook,xlsx,
      fields:Object.fromEntries(PLANOGRAM_FIELDS.map(field=>[field.key,field.defaultChecked]))
    };
    pendingPlanogramImport.selectedPrices={};
    items.forEach(item=>{
      const product=item.matchProductId?productById(item.matchProductId):null;
      const suggestion=planogramRecommendedPrice(item,product);
      const current=item.price??(product?productInventory(product).price:null);
      if(suggestion!==null&&current!==null&&Math.abs(suggestion-current)>=0.005){
        pendingPlanogramImport.selectedPrices[item.sourceRow]=true;
      }
    });
    const updates=items.filter(item=>item.status==="update").length;
    const creates=items.filter(item=>item.status==="create").length;
    const conflicts=items.filter(item=>item.status==="conflict").length;
    message.textContent=`Análise concluída: ${items.length} linha(s) · ${updates} correspondência(s) · ${creates} produto(s) novo(s) · ${conflicts} linha(s) com conflito/erro. Aba: ${sheetName}.`;
    renderPlanogramPreview();
  }catch(error){
    pendingPlanogramImport=null;
    message.className="info planogram-message error";
    message.textContent=error instanceof Error?`Não foi possível analisar o planograma: ${error.message}`:"Falha ao analisar o planograma.";
  }
}
function planogramCurrentValue(product,key){
  if(!product) return null;
  if(key==="ean") return Array.isArray(product.eans)?product.eans.join(", "):"";
  return product[key]??(key==="sku"||key==="planogramType"?"":"");
}
function formatPlanogramValue(key,value){
  if(value===null||value===undefined||value==="") return "—";
  if(key==="price") return money(value);
  if(["shelfCapacity","min","target","stock"].includes(key)) return Number(value).toLocaleString("pt-BR",{maximumFractionDigits:3});
  return String(value);
}
function planogramChanges(item,product,fields){
  const changes=[];
  PLANOGRAM_FIELDS.forEach(field=>{
    if(!fields[field.key]&&!(field.key==="name"&&!product)) return;
    const incoming=item[field.key];
    if(incoming===null||incoming===undefined||incoming==="") return;
    const current=planogramCurrentValue(product,field.key);
    const comparisonKey=field.key==="ean"?"ean":field.key;
    const currentComparison=field.key==="ean"
      ?(Array.isArray(product?.eans)&&product.eans.map(normalizeGtin).includes(normalizeGtin(incoming))?incoming:current)
      :current;
    if(String(currentComparison??"")===String(incoming)) return;
    changes.push({label:field.label,current:formatPlanogramValue(comparisonKey,current),incoming:formatPlanogramValue(comparisonKey,incoming)});
  });
  return changes;
}
function setPlanogramField(fieldKey,checked){
  if(!pendingPlanogramImport) return;
  pendingPlanogramImport.fields[fieldKey]=Boolean(checked);
  renderPlanogramPreview();
}
function setPlanogramPriceSelection(sourceRow,checked){
  if(!pendingPlanogramImport) return;
  pendingPlanogramImport.selectedPrices[sourceRow]=Boolean(checked);
  renderPlanogramPreview();
}
function selectedPlanogramPriceItems(){
  if(!pendingPlanogramImport) return [];
  return pendingPlanogramImport.items.filter(item=>
    pendingPlanogramImport.selectedPrices[item.sourceRow]
    &&item.status==="update"
    &&planogramRecommendedPrice(item,productById(item.matchProductId))!==null
  );
}
// Mostra diferenças e permite escolher quais campos do planograma serão aplicados.
function renderPlanogramPreview(){
  const root=document.getElementById("planogram-preview");
  if(!root||!pendingPlanogramImport) return;
  const imported=pendingPlanogramImport;
  const fields=imported.fields;
  const query=normalizePlanogramHeader(imported.query);
  const filtered=imported.items.filter(item=>{
    const product=item.matchProductId?productById(item.matchProductId):null;
    return !query||normalizePlanogramHeader([
      item.planogramId,item.sku,item.ean,item.name,item.category,product?.name
    ].join(" ")).includes(query);
  });
  const pageSize=25,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  imported.page=Math.max(0,Math.min(imported.page,pageCount-1));
  const pageItems=filtered.slice(imported.page*pageSize,(imported.page+1)*pageSize);
  const updateCount=imported.items.filter(item=>item.status==="update").length;
  const createCount=imported.items.filter(item=>item.status==="create").length;
  const conflictCount=imported.items.filter(item=>item.status==="conflict").length;
  const selectedPriceCount=selectedPlanogramPriceItems().length;
  const fieldChoices=PLANOGRAM_FIELDS.map(field=>`<label class="planogram-field"><input type="checkbox" data-planogram-field="${field.key}" ${fields[field.key]?"checked":""} ${field.required?"disabled":""}><span>${esc(field.label)}</span></label>`).join("");
  const rows=pageItems.map(item=>{
    const product=item.matchProductId?productById(item.matchProductId):null;
    const badge=item.status==="update"?'<span class="badge ok">Atualizar</span>':item.status==="create"?'<span class="badge warning">Novo</span>':'<span class="badge danger">Conflito</span>';
    const changes=item.status==="conflict"?[]:planogramChanges(item,product,fields);
    const suggestion=planogramRecommendedPrice(item,product);
    const inventory=product?productInventory(product):null;
    const currentPlanogramPrice=item.price??inventory?.price??null;
    const detail=changes.length
      ?`<details><summary>${changes.length} campo(s) selecionado(s)</summary><ul>${changes.map(change=>`<li><strong>${esc(change.label)}:</strong> ${esc(change.current)} → ${esc(change.incoming)}</li>`).join("")}</ul></details>`
      :item.status==="conflict"?`<span class="planogram-error">${esc(item.errors.join("; "))}</span>`:"Sem alteração nos campos selecionados";
    const recommendation=suggestion===null
      ?`<span class="product-sub">${pricingSettings().configured?"Sem custo ou correspondência única":"Configure as regras de preço"}</span>`
      :`<label class="planogram-price-choice"><input type="checkbox" data-planogram-price="${item.sourceRow}" ${imported.selectedPrices[item.sourceRow]?"checked":""}><span>${money(currentPlanogramPrice)} → <strong>${money(suggestion)}</strong></span></label>`;
    return `<tr><td>${item.sourceRow}</td><td>${badge}</td><td>${esc(item.planogramId||item.sku||item.ean||"—")}</td><td>${esc(product?.name||"Novo produto")}<span class="product-sub">${esc(item.name)}</span></td><td>${currentPlanogramPrice===null?"—":money(currentPlanogramPrice)}</td><td>${recommendation}</td><td>${detail}</td></tr>`;
  }).join("");
  root.innerHTML=`
    <div class="planogram-summary">
      <div><strong>${imported.items.length}</strong><span>linhas lidas</span></div>
      <div><strong>${updateCount}</strong><span>correspondências</span></div>
      <div><strong>${createCount}</strong><span>produtos novos</span></div>
      <div><strong>${conflictCount}</strong><span>conflitos/erros</span></div>
    </div>
    <div class="planogram-price-toolbar">
      <div><strong>Análise de preço</strong><span>${selectedPriceCount} preço(s) selecionado(s) · custo, perdas, margem, impostos e taxas da unidade atual</span></div>
      <div><button class="btn small" id="select-planogram-prices" ${pricingSettings().configured?"":"disabled"}>Selecionar diferenças</button> <button class="btn small ghost" id="clear-planogram-prices">Limpar seleção</button></div>
    </div>
    <p class="planogram-source"><strong>Arquivo:</strong> ${esc(imported.fileName)} · <strong>Aba:</strong> ${esc(imported.sheetName)} · O ID do planograma será guardado para facilitar as próximas atualizações.</p>
    <div class="planogram-safety"><strong>Proteções:</strong> custo de compra nunca é importado; estoque atual só será atualizado se você marcar o campo; produtos ausentes do arquivo permanecem no catálogo. Linhas com conflito serão ignoradas.</div>
    <div class="planogram-fields"><strong>Selecione os campos desta importação:</strong><div>${fieldChoices}</div></div>
    <div class="planogram-preview-toolbar"><input id="planogram-search" type="search" value="${esc(imported.query)}" placeholder="Filtrar por ID, código ou nome"><span>Mostrando ${filtered.length?imported.page*pageSize+1:0}–${Math.min((imported.page+1)*pageSize,filtered.length)} de ${filtered.length}</span></div>
    <div class="table-wrap planogram-table-wrap"><table class="planogram-table"><thead><tr><th>Linha</th><th>Ação</th><th>ID/código</th><th>Produto</th><th>Preço no arquivo</th><th>Preço sugerido</th><th>Prévia dos campos</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Nenhum resultado para o filtro.</td></tr>'}</tbody></table></div>
    <div class="planogram-actions"><div><button class="btn" id="planogram-prev-page" ${imported.page<=0?"disabled":""}>Anterior</button> <span>Página ${imported.page+1} de ${pageCount}</span> <button class="btn" id="planogram-next-page" ${imported.page>=pageCount-1?"disabled":""}>Próxima</button></div><div><button class="btn ghost" id="cancel-planogram-btn">Cancelar</button> <button class="btn" id="apply-planogram-prices" ${selectedPriceCount?"":"disabled"}>Atualizar catálogo (${selectedPriceCount})</button> <button class="btn" id="export-planogram-prices" ${selectedPriceCount?"":"disabled"}>Baixar planograma (${selectedPriceCount})</button> <button class="btn primary" id="confirm-planogram-btn" ${updateCount+createCount===0?"disabled":""}>Aplicar ${updateCount+createCount} produto(s)</button></div></div>`;
  root.querySelectorAll("[data-planogram-price]").forEach(input=>{
    input.addEventListener("change",()=>setPlanogramPriceSelection(Number(input.dataset.planogramPrice),input.checked));
  });
  root.querySelector("#select-planogram-prices").addEventListener("click",()=>{
    imported.items.forEach(item=>{
      const product=item.matchProductId?productById(item.matchProductId):null;
      const suggestion=planogramRecommendedPrice(item,product);
      const current=item.price??(product?productInventory(product).price:null);
      imported.selectedPrices[item.sourceRow]=suggestion!==null&&current!==null&&Math.abs(suggestion-current)>=0.005;
    });
    renderPlanogramPreview();
  });
  root.querySelector("#clear-planogram-prices").addEventListener("click",()=>{
    imported.selectedPrices={};renderPlanogramPreview();
  });
  root.querySelector("#apply-planogram-prices").addEventListener("click",applySelectedPlanogramPrices);
  root.querySelector("#export-planogram-prices").addEventListener("click",exportSelectedPlanogramPrices);
  root.querySelectorAll("[data-planogram-field]").forEach(input=>{
    input.addEventListener("change",()=>setPlanogramField(input.dataset.planogramField,input.checked));
  });
  root.querySelector("#planogram-search").addEventListener("input",event=>{
    imported.query=event.target.value;imported.page=0;renderPlanogramPreview();
  });
  root.querySelector("#planogram-prev-page").addEventListener("click",()=>{imported.page--;renderPlanogramPreview();});
  root.querySelector("#planogram-next-page").addEventListener("click",()=>{imported.page++;renderPlanogramPreview();});
  root.querySelector("#cancel-planogram-btn").addEventListener("click",()=>{
    pendingPlanogramImport=null;
    root.innerHTML="";
    document.getElementById("planogram-message").textContent="Importação cancelada. Nenhum produto foi alterado.";
  });
  root.querySelector("#confirm-planogram-btn").addEventListener("click",confirmPlanogramImport);
}
function validateSelectedPlanogramPrices(items){
  const staleItem=items.find(item=>{
    const matches=matchPlanogramProduct(item);
    return matches.length!==1||matches[0].id!==item.matchProductId;
  });
  if(staleItem){
    const message=document.getElementById("planogram-message");
    if(message){
      message.className="info planogram-message error";
      message.textContent="O catálogo mudou desde a análise. Analise a planilha novamente antes de atualizar preços.";
    }
    return false;
  }
  return true;
}
function applySelectedPlanogramPrices(){
  const items=selectedPlanogramPriceItems();
  if(!items.length||!validateSelectedPlanogramPrices(items)) return;
  if(!confirm(`Atualizar no catálogo da unidade ${activeLocation().name} os preços de ${items.length} produto(s) selecionado(s)?`)) return;
  items.forEach(item=>{
    const product=productById(item.matchProductId);
    const price=planogramRecommendedPrice(item,product);
    if(price!==null) updateSalePrice(product,price,"Preço recomendado pelo planograma");
  });
  saveData();
  renderPlanogramPreview();
  const message=document.getElementById("planogram-message");
  if(message) message.textContent=`Catálogo atualizado com ${items.length} preço(s) recomendado(s) para ${activeLocation().name}.`;
}
function planogramExportGrid(items){
  const imported=pendingPlanogramImport;
  const grid=imported.sourceGrid.map(row=>[...row]);
  let priceColumn=imported.columns.price;
  if(priceColumn===undefined){
    priceColumn=Math.max(0,...grid.map(row=>row.length));
    grid[imported.headerIndex][priceColumn]="Preço de venda";
  }
  items.forEach(item=>{
    const price=planogramRecommendedPrice(item,productById(item.matchProductId));
    if(price===null) return;
    const rowIndex=item.sourceRow-1;
    while(grid.length<=rowIndex) grid.push([]);
    while(grid[rowIndex].length<=priceColumn) grid[rowIndex].push("");
    grid[rowIndex][priceColumn]=price;
  });
  return {grid,priceColumn};
}
function serializeDelimitedGrid(grid,delimiter){
  const escape=value=>{
    const text=String(value??"");
    return text.includes(delimiter)||text.includes('"')||/[\r\n]/.test(text)
      ?`"${text.replace(/"/g,'""')}"`
      :text;
  };
  return `\uFEFF${grid.map(row=>row.map(escape).join(delimiter)).join("\r\n")}`;
}
function exportSelectedPlanogramPrices(){
  const items=selectedPlanogramPriceItems();
  if(!items.length||!validateSelectedPlanogramPrices(items)) return;
  try{
    const {grid,priceColumn}=planogramExportGrid(items);
    const imported=pendingPlanogramImport;
    const baseName=imported.fileName.replace(/\.[^.]+$/,"");
    if(["xlsx","xls"].includes(imported.fileExtension)){
      const worksheet=imported.workbook.Sheets[imported.sheetName];
      const range=worksheet["!ref"]?imported.xlsx.utils.decode_range(worksheet["!ref"]):{s:{r:0,c:0},e:{r:0,c:0}};
      if(imported.columns.price===undefined){
        worksheet[imported.xlsx.utils.encode_cell({r:imported.sheetOrigin.row+imported.headerIndex,c:imported.sheetOrigin.column+priceColumn})]={t:"s",v:"Preço de venda"};
      }
      items.forEach(item=>{
        const price=planogramRecommendedPrice(item,productById(item.matchProductId));
        if(price===null) return;
        const rowIndex=imported.sheetOrigin.row+item.sourceRow-1;
        worksheet[imported.xlsx.utils.encode_cell({r:rowIndex,c:imported.sheetOrigin.column+priceColumn})]={t:"n",v:price};
        range.e.r=Math.max(range.e.r,rowIndex);
      });
      range.e.c=Math.max(range.e.c,imported.sheetOrigin.column+priceColumn);
      worksheet["!ref"]=imported.xlsx.utils.encode_range(range);
      const output=imported.xlsx.write(imported.workbook,{bookType:"xlsx",type:"array"});
      downloadBlob(output,`${baseName}-precos-atualizados.xlsx`,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }else{
      downloadBlob(serializeDelimitedGrid(grid,imported.delimiter),`${baseName}-precos-atualizados.${imported.fileExtension}`,"text/csv;charset=utf-8");
    }
    const message=document.getElementById("planogram-message");
    if(message) message.textContent=`Planilha gerada com ${items.length} preço(s) recomendado(s). Revise o arquivo antes de enviá-lo para a loja.`;
  }catch(error){
    const message=document.getElementById("planogram-message");
    if(message){
      message.className="info planogram-message error";
      message.textContent=error instanceof Error?`Não foi possível exportar o planograma: ${error.message}`:"Não foi possível exportar o planograma.";
    }
  }
}
// Aplica apenas as alterações selecionadas depois da confirmação do operador.
function confirmPlanogramImport(){
  if(!pendingPlanogramImport) return;
  const imported=pendingPlanogramImport;
  const validItems=imported.items.filter(item=>item.status==="update"||item.status==="create");
  if(!validItems.length) return;
  const staleItem=validItems.find(item=>{
    const matches=matchPlanogramProduct(item);
    return item.status==="update"
      ?matches.length!==1||matches[0].id!==item.matchProductId
      :matches.length!==0;
  });
  if(staleItem){
    document.getElementById("planogram-message").className="info planogram-message error";
    document.getElementById("planogram-message").textContent="O catálogo mudou desde a análise. Analise a planilha novamente antes de aplicar para evitar correspondências incorretas.";
    return;
  }
  const fields=imported.fields;
  const nextState={
    ...state,
    products:state.products.map(product=>({...product,eans:[...(product.eans||[])],supplierCodes:{...(product.supplierCodes||{})} })),
    priceHistory:[...state.priceHistory],
    auditLog:[...state.auditLog]
  };
  const productsById=new Map(nextState.products.map(product=>[product.id,product]));
  let created=0,updated=0,unchanged=0;
  const timestamp=new Date().toISOString();
  const audit=(product,field,previousValue,newValue)=>{
    if(String(previousValue??"")===String(newValue??"")) return;
    nextState.auditLog.push({
      id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:product.id,field,
      previousValue,newValue,date:timestamp,user:"Operador local",source:"Importação do planograma",locationId:activeLocationId()
    });
  };
  try{
    for(const item of validItems){
      let product=item.matchProductId?productsById.get(item.matchProductId):null;
      const wasCreated=!product;
      if(!product){
        product={
          id:`p${Date.now()}${Math.random()}`,name:item.name,planogramId:"",
          sku:"",eans:[],supplierCodes:{},category:"",supplier:"",
          cost:0,price:0,stock:0,min:0,target:0,daily:0,
          shelfCapacity:0,planogramType:""
        };
        nextState.products.push(product);
        productsById.set(product.id,product);
      }
      const changedBefore=nextState.auditLog.length;
      const previousPlanogramId=product.planogramId||"";
      product.planogramId=item.planogramId||previousPlanogramId;
      audit(product,"planogramId",previousPlanogramId,product.planogramId);
      const assignments=[
        ["name","name"],["sku","sku"],["category","category"],
        ["price","price"],["shelfCapacity","shelfCapacity"],
        ["min","min"],["target","target"],["stock","stock"],
        ["planogramType","planogramType"]
      ];
      for(const [sourceKey,productKey] of assignments){
        if(sourceKey==="name"&&!fields.name) continue;
        if(sourceKey!=="name"&&!fields[sourceKey]) continue;
        const value=item[sourceKey];
        if(value===null||value===undefined||value==="") continue;
        const previous=product[productKey]??"";
        const previousCost=Number(product.cost||0);
        product[productKey]=value;
        if(productKey==="price"&&Number(previous)!==Number(value)){
          nextState.priceHistory.push(createPriceHistoryEntry(
            product,Number(previous||0),Number(value),"Importação do planograma",
            {date:timestamp,previousCost,newCost:Number(product.cost||0)}
          ));
        }
        audit(product,productKey,previous,value);
      }
      if(fields.ean&&item.ean&&!product.eans.some(ean=>normalizeGtin(ean)===normalizeGtin(item.ean))){
        const previous=product.eans.join(", ");
        product.eans.push(item.ean);
        audit(product,"eans",previous,product.eans.join(", "));
      }
      if(wasCreated) created++;
      else if(nextState.auditLog.length>changedBefore) updated++;
      else unchanged++;
    }
    saveData(nextState);
    state=nextState;
  }catch(error){
    document.getElementById("planogram-message").className="info planogram-message error";
    document.getElementById("planogram-message").textContent=error instanceof Error
      ?`Não foi possível salvar a importação; o catálogo não foi atualizado: ${error.message}`
      :"Não foi possível salvar a importação; o catálogo não foi atualizado.";
    return;
  }
  const skipped=imported.items.length-validItems.length;
  pendingPlanogramImport=null;
  render();
  const message=document.getElementById("planogram-message");
  if(message) message.textContent=`Planograma aplicado: ${created} produto(s) criado(s), ${updated} atualizado(s), ${unchanged} sem alteração e ${skipped} linha(s) ignorada(s) por conflito/erro. Custo de compra foi preservado.`;
}
function num(v){ return Number(String(v??0).replace(/\./g,"").replace(",", ".")) || 0; }
function downloadBlob(content,name,type){
  const a=document.createElement("a");
  const url=URL.createObjectURL(new Blob([content],{type}));
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// 11. Formulário modal e ações diretas do catálogo.
function openProductModal(product=null){
  document.getElementById("product-modal").classList.remove("hidden");
  document.getElementById("modal-title").textContent=product?"Editar produto":"Novo produto";
  document.getElementById("product-id").value=product?.id||"";
  document.getElementById("p-name").value=product?.name||"";
  document.getElementById("p-sku").value=product?.sku||"";
  document.getElementById("p-category").value=product?.category||"";
  document.getElementById("p-supplier").value=product?.supplier||"";
  document.getElementById("p-cost").value=product?.cost??"";
  document.getElementById("p-price").value=product?.price??"";
  document.getElementById("p-stock").value=product?.stock??0;
  document.getElementById("p-min").value=product?.min??0;
  document.getElementById("p-target").value=product?.target??0;
  document.getElementById("p-daily").value=product?.daily??0;
}
function closeModal(){ document.getElementById("product-modal").classList.add("hidden"); }
document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",closeModal));
document.getElementById("close-product-history").addEventListener("click",closeProductHistory);
document.getElementById("product-history-modal").addEventListener("click",event=>{
  if(event.target.id==="product-history-modal") closeProductHistory();
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape") closeProductHistory();
});
document.getElementById("product-form").addEventListener("submit",e=>{
  e.preventDefault();
  const id=document.getElementById("product-id").value;
  const obj={
    name:document.getElementById("p-name").value.trim(),
    sku:document.getElementById("p-sku").value.trim(),
    category:document.getElementById("p-category").value.trim(),
    supplier:document.getElementById("p-supplier").value.trim(),
    cost:Number(document.getElementById("p-cost").value),
    price:Number(document.getElementById("p-price").value),
    stock:Number(document.getElementById("p-stock").value),
    min:Number(document.getElementById("p-min").value),
    target:Number(document.getElementById("p-target").value),
    daily:Number(document.getElementById("p-daily").value)
  };
  if(id){
    const p=productById(id);
    const previousCost=Number(p.cost||0),previousPrice=Number(p.price||0),previousStock=Number(p.stock||0);
    Object.assign(p,obj);
    const timestamp=new Date().toISOString();
    if(previousCost!==obj.cost) state.auditLog.push({id:`a${Date.now()}${Math.random()}`,entity:"product",entityId:p.id,field:"cost",previousValue:previousCost,newValue:obj.cost,date:timestamp,user:"Operador local",source:"Edição manual",locationId:activeLocationId()});
    if(previousStock!==obj.stock) recordStockChange(p,previousStock,obj.stock,"Edição manual",activeLocationId(),timestamp);
    if(previousPrice!==obj.price) recordPriceChange(p,previousPrice,obj.price,"Edição manual",{date:timestamp,previousCost,newCost:obj.cost});
  }
  else {
    const product={id:"p"+Date.now(),eans:[],supplierCodes:{},...obj};
    state.products.push(product);
    if(obj.stock>0) recordStockChange(product,0,obj.stock,"Cadastro inicial");
    if(obj.price>0) recordPriceChange(product,0,obj.price,"Cadastro inicial",{previousCost:0,newCost:obj.cost});
  }
  saveData(); closeModal(); render();
});
function editProduct(id){ openProductModal(productById(id)); }
function deleteProduct(id){
  const p=productById(id);
  if(!confirm(`Excluir "${p.name}"?`)) return;
  state.products=state.products.filter(x=>x.id!==id);
  state.sales=state.sales.filter(x=>x.productId!==id);
  saveData(); render();
}
function navigateTo(section){
  currentSection=section;
  render();
}
function goPricing(){ navigateTo("precificacao"); }
function goPurchase(){ navigateTo("compras"); }
function goReceive(){ navigateTo("importar"); }
function goPurchaseForLocation(locationId){
  setActiveLocation(locationId);
  navigateTo("compras");
}
function goCentral(){ if(centralInventoryEnabled()) navigateTo("central"); }
function goStores(){ navigateTo("lojas"); }
function goDashboardPlanogram(){
  navigateTo("importar");
  requestAnimationFrame(()=>{
    const panel=document.getElementById("planogram-section");
    if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
  });
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

render();
