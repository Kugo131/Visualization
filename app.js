/* Vue manages state and filters; D3 draws the interactive monthly chart. */
const {createApp,ref,computed,watch,nextTick,onMounted,onBeforeUnmount}=Vue;
createApp({
 setup(){
  const all=window.ORDERS_DATA||[];
  const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const shortMonths=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const years=[...new Set(all.map(r=>+r.d.slice(0,4)))].sort((a,b)=>b-a);
  const categories=[...new Set(all.filter(r=>r.c!=='Услуги Груши').map(r=>r.c))].sort((a,b)=>a.localeCompare(b,'ru'));
  const year=ref('all'),month=ref('all'),category=ref('all'),metric=ref('spend'),ranking=ref('quantity'),search=ref(''),visibleCount=ref(10);
  const metrics=[{id:'spend',label:'Сумма трат'},{id:'orders',label:'Заказы'},{id:'discount',label:'Скидка'}];
  const trendSvg=ref(null),trendWrap=ref(null),tooltip=ref(null);
  const delivered=all.filter(d=>d.s.toLowerCase().trim()==='доставлен');
  const isProduct=d=>d.c!=='Услуги Груши';
  const filtered=computed(()=>delivered.filter(d=>(year.value==='all'||d.d.slice(0,4)===year.value)&&(month.value==='all'||+d.d.slice(5,7)===+month.value)&&(category.value==='all'||d.c===category.value)));
  const productRows=computed(()=>filtered.value.filter(isProduct));
  const kpis=computed(()=>{
   const rows=filtered.value,original=d3.sum(rows,d=>d.p*d.q),spend=d3.sum(rows,d=>d.a);
   return {orders:new Set(rows.map(d=>d.o)).size,spend,discount:original?100*(original-spend)/original:0,savings:original-spend};
  });
  const scopeLabel=computed(()=>[year.value==='all'?'Сентябрь 2021 — август 2026':year.value+' год',month.value==='all'?'':months[+month.value-1],category.value==='all'?'Все категории':category.value].filter(Boolean).join(' · '));
  // Monthly aggregation of unique orders, actual paid value and weighted discount.
  const monthly=computed(()=>{
   const map=d3.group(filtered.value,d=>d.d.slice(0,7));
   return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
    const original=d3.sum(rows,r=>r.p*r.q),spend=d3.sum(rows,r=>r.a);
    return {key,date:d3.timeParse('%Y-%m')(key),orders:new Set(rows.map(d=>d.o)).size,spend,discount:original?100*(original-spend)/original:0};
   });
  });
  const categorySpend=computed(()=>[...d3.rollup(productRows.value,v=>d3.sum(v,d=>d.a),d=>d.c)].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value));
  const productCount=computed(()=>new Set(productRows.value.map(d=>d.n)).size);
  const productQuantity=computed(()=>d3.sum(productRows.value,d=>d.q));
  const matchingProducts=computed(()=>{
   const group=d3.group(productRows.value,d=>d.n);
   const q=search.value.trim().toLocaleLowerCase('ru');
   return [...group].map(([name,rs])=>({name,category:rs[0].c,image:rs.find(r=>r.im)?.im||'',quantity:d3.sum(rs,r=>r.q),spend:d3.sum(rs,r=>r.a),orders:new Set(rs.map(r=>r.o)).size})).filter(r=>!q||r.name.toLocaleLowerCase('ru').includes(q)).sort((a,b)=>(ranking.value==='quantity'?b.quantity-a.quantity:b.spend-a.spend)||a.name.localeCompare(b.name,'ru'));
  });
  const products=computed(()=>matchingProducts.value.slice(0,visibleCount.value));
  const integer=n=>Math.round(n).toLocaleString('ru-RU');
  const rubles=n=>integer(n)+' ₽';
  const pct=n=>n.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' %';
  const resetFilters=()=>{year.value='all';month.value='all';category.value='all';search.value='';};
  const hideBroken=e=>{e.target.style.display='none';};
  let observer;
  function drawChart(){
   const svgNode=trendSvg.value,wrapper=trendWrap.value;if(!svgNode||!wrapper)return;
   const data=monthly.value;
   const width=Math.max(wrapper.clientWidth,260),height=Math.max(wrapper.clientHeight,200);
   const compact=width<600,margin={top:24,right:compact?12:28,bottom:41,left:compact?44:66};
   const w=width-margin.left-margin.right,h=height-margin.top-margin.bottom;
   const svg=d3.select(svgNode).attr('viewBox',`0 0 ${width} ${height}`);
   svg.selectAll('*').remove();if(!data.length)return;
   const g=svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
   // Point scale accommodates one selected month and irregular subsets.
   const x=d3.scalePoint().domain(data.map(d=>d.key)).range([0,w]).padding(data.length===1?.5:.1);
   const max=d3.max(data,d=>d[metric.value])||1;
   const y=d3.scaleLinear().domain([0,max*1.16]).nice(4).range([h,0]);
   g.append('g').selectAll('line').data(y.ticks(4)).enter().append('line').attr('class','grid-line').attr('x1',0).attr('x2',w).attr('y1',d=>y(d)).attr('y2',d=>y(d));
   const fmtAxis=metric.value==='discount'?v=>`${Math.round(v)}%`:v=>d3.format('~s')(v).replace('k',' тыс.').replace('M',' млн');
   g.append('g').attr('class','axis').call(d3.axisLeft(y).ticks(4).tickFormat(fmtAxis).tickSize(0).tickPadding(12));
   const stride=Math.max(1,Math.ceil(data.length/(compact?5:11)));
   const keys=data.filter((_,i)=>i%stride===0||i===data.length-1).map(d=>d.key);
   g.append('g').attr('class','axis').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).tickValues([...new Set(keys)]).tickSize(0).tickPadding(15).tickFormat(s=>{const [yr,mo]=s.split('-');return shortMonths[+mo-1]+(year.value==='all'?` '${yr.slice(2)}`:'');}));
   const line=d3.line().x(d=>x(d.key)).y(d=>y(d[metric.value])).curve(d3.curveMonotoneX);
   const area=d3.area().x(d=>x(d.key)).y0(h).y1(d=>y(d[metric.value])).curve(d3.curveMonotoneX);
   const defs=svg.append('defs');const gradient=defs.append('linearGradient').attr('id','chart-gradient').attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');gradient.append('stop').attr('offset','0%').attr('stop-color','#957beb').attr('stop-opacity',.30);gradient.append('stop').attr('offset','100%').attr('stop-color','#957beb').attr('stop-opacity',.01);
   g.append('path').datum(data).attr('fill','url(#chart-gradient)').attr('d',area);
   g.append('path').datum(data).attr('fill','none').attr('stroke','#7d62da').attr('stroke-width',3).attr('stroke-linecap','round').attr('stroke-linejoin','round').attr('d',line);
   const hoverLine=g.append('line').attr('y1',0).attr('y2',h).attr('stroke','#b5a3ef').attr('stroke-dasharray','4 4').style('display','none');
   const hoverDot=g.append('circle').attr('r',6).attr('fill','#7d62da').attr('stroke','white').attr('stroke-width',3).style('display','none');
   // Nearest-month hover works on bars/lines, including touch devices.
   g.append('rect').attr('width',w).attr('height',h).attr('fill','transparent').on('mousemove touchmove',function(event){
    const [px]=d3.pointer(event,this);
    const point=data.reduce((a,b)=>Math.abs(x(b.key)-px)<Math.abs(x(a.key)-px)?b:a);
    const cx=x(point.key),cy=y(point[metric.value]);hoverLine.attr('x1',cx).attr('x2',cx).style('display',null);hoverDot.attr('cx',cx).attr('cy',cy).style('display',null);
    const [yr,mo]=point.key.split('-');const label=months[+mo-1]+' '+yr;
    tooltip.value.innerHTML=`<strong>${label}</strong><div>Заказы: ${integer(point.orders)}</div><div>Траты: ${rubles(point.spend)}</div><div>Средняя скидка: ${pct(point.discount)}</div>`;
    tooltip.value.style.display='block';const rect=wrapper.getBoundingClientRect();let ex=event.clientX,ey=event.clientY;if(event.touches?.length){ex=event.touches[0].clientX;ey=event.touches[0].clientY;}
    tooltip.value.style.left=Math.min(ex+16,window.innerWidth-190)+'px';tooltip.value.style.top=Math.max(8,ey-98)+'px';
   }).on('mouseleave touchend',()=>{hoverLine.style('display','none');hoverDot.style('display','none');tooltip.value.style.display='none';});
  }
  watch([filtered,metric],()=>nextTick(drawChart));
  watch([ranking,search,year,month,category],()=>{visibleCount.value=10;});
  onMounted(()=>{drawChart();observer=new ResizeObserver(()=>drawChart());if(trendWrap.value)observer.observe(trendWrap.value);});
  onBeforeUnmount(()=>{observer?.disconnect();});
  return {all,years,months,categories,year,month,category,metric,metrics,ranking,search,visibleCount,trendSvg,trendWrap,tooltip,filtered,kpis,scopeLabel,monthly,categorySpend,productCount,productQuantity,matchingProducts,products,integer,rubles,pct,resetFilters,hideBroken};
 }
}).mount('#app');
