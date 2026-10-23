import { createHash } from 'node:crypto';
export const evaluationId=(kind,key)=>{
 const hex=createHash('sha256').update(`mindcare-clinical-20261022:${kind}:${key}`).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
const themes=[
 ['anxiété','des inquiétudes qui occupent les soirées','repérer les pensées anticipatoires','un exercice de respiration et un temps réservé aux préoccupations'],
 ['sommeil','des réveils qui rendent les matinées difficiles','retrouver des horaires de sommeil réguliers','le relevé des heures de coucher et des réveils'],
 ['deuil','une tristesse liée à la perte d’un proche','pouvoir évoquer la perte à son rythme','la mise en mots des souvenirs et le maintien des liens de soutien'],
 ['relations familiales','des échanges tendus au sein de la famille','poser une limite sans interrompre le dialogue','la préparation d’une conversation avec un proche'],
 ['conflit avec le père','des désaccords répétés avec le père','exprimer un besoin sans escalade du conflit','la distinction entre les faits, les émotions et la demande formulée'],
 ['humeur dépressive','une baisse de l’élan et un retrait des activités habituelles','reprendre progressivement une activité appréciée','la planification d’une activité courte et accessible'],
 ['usage de substances','des consommations devenues difficiles à maîtriser','identifier les situations qui précèdent les consommations','le relevé des envies et la préparation d’une alternative concrète'],
 ['vie conjugale','des disputes qui laissent peu de place à l’écoute','rétablir un échange plus posé dans le couple','la formulation d’une demande précise et un temps de discussion limité'],
 ['épuisement professionnel','une fatigue qui déborde sur la vie personnelle','retrouver des limites entre travail et repos','le repérage des sollicitations évitables et la préparation d’une limite'],
 ['difficultés scolaires','un découragement devant les tâches scolaires','fractionner le travail et demander une aide adaptée','la préparation d’un planning court avec des pauses régulières'],
];
const settings=['lorsque plusieurs demandes arrivent en même temps','en fin de journée','après un échange difficile','durant les périodes moins structurées','quand la fatigue s’accumule','au retour des activités habituelles','pendant les moments de solitude'];
const activities=['une promenade courte','un repas à heure régulière','un appel à une personne de confiance','une pause sans écran','un moment de lecture','une activité manuelle','un trajet habituel','une sortie accompagnée','un temps de repos prévu','une tâche domestique simple','un échange préparé à l’avance','un exercice de détente','un réveil à heure régulière','une activité choisie à l’extérieur','un temps consacré à la musique','une courte séance de rangement','une demande d’aide explicite','un repas partagé','un temps calme avant le coucher'];
const barriers=['le manque de régularité','la crainte de décevoir','la difficulté à commencer','les changements d’horaire','la fatigue en cours de journée','les interruptions fréquentes','le sentiment de devoir tout terminer','le manque de temps calme','la difficulté à demander du soutien','les attentes trop élevées','la tendance à remettre à plus tard','la difficulté à garder une limite','les imprévus de la semaine'];
const trajectories=[ [8,7,6,5,4,3,3,2], [7,7,6,7,6,6,5,5], [8,6,4,7,6,5,4,3], [8,7,6,7,5,6,4,4], [6,5,4,3,2,2,1,1] ];
export function visitContent({patientId,index,position,count,birthDate,at}){
 const age=(Date.parse(at)-Date.parse(birthDate))/31557600000;
 if(age<0)throw Error('VisitBeforeBirth');
 const topic=age<6?1:age<18?[1,2,3,4,9][index%5]:index%themes.length;
 const [focus,problem,goal,work]=themes[topic];
 const progress=position/(count-1||1),step=Math.min(7,Math.round(progress*7));
 const course=trajectories[index%trajectories.length],score=course[step];
 const previousStep=Math.min(7,Math.round(Math.max(0,position-1)/(count-1||1)*7));
 const previous=course[previousStep],context=settings[(index+position)%settings.length];
 const change=position===0?'La première rencontre précise les difficultés et les attentes.':score<previous?'La personne rapporte un mieux depuis le dernier entretien.':score>previous?'La personne rapporte une reprise des difficultés depuis le dernier entretien.':'La personne rapporte peu de changement depuis le dernier entretien.';
 const adherence=index%4===3&&position%3===1?'Les exercices prévus ont été repris de façon irrégulière.':position===0?'Les premiers repères sont discutés ensemble.':'La personne décrit avoir repris les repères travaillés à la séance précédente.';
 const activity=activities[(index*13+position*17)%activities.length],barrier=barriers[(index*7+position*11)%barriers.length];
 const achievement=progress>.7&&score<=3?'L’objectif devient plus accessible, même si une consolidation reste utile.':'L’objectif reste à travailler avec des étapes limitées et concrètes.';
 const details={focus:[focus],focusLibre:goal,mesures:{anxiete:Math.min(10,score+(topic===0?1:0)),sommeil:Math.max(1,score-(topic===1?0:1)),humeur:Math.min(10,score+(topic===5?1:0))},scoreConvention:'difficulty-v1'};
 const content={raw:`La séance porte sur ${problem}, surtout ${context}. ${change} ${adherence} Un point concret est repris autour de ${activity} ; l’obstacle décrit est ${barrier}.`,
 subjective:`La personne décrit ${problem}. La gêne est surtout présente ${context}. ${change} La discussion précise le rôle de ${barrier} lors de la reprise de ${activity}.`,
 objective:`L’entretien permet de préciser une situation récente autour de ${activity}. ${score>=7?'Une tension est observable lors de l’évocation de cette situation.':'L’échange reste suivi et les situations sont décrites avec précision.'} L’obstacle discuté est ${barrier}.`,
 assessment:`Le travail vise à ${goal}. ${achievement} ${adherence} Le prochain repère retenu concerne ${activity}, en tenant compte de ${barrier}.`,
 plan:`Le travail de séance a porté sur ${work}. Il est convenu de prévoir ${activity}, puis de noter ce qui facilite cette démarche et ce qui la freine, notamment ${barrier}. Le prochain rendez-vous permettra de faire le point.`,
 structured:{sessionDetails:details,evaluation:{campaign:'clinical-20261022',generatorVersion:2,patientRef:patientId,visit:position+1,trajectory:index%trajectories.length}}};
 if(age<6)for(const key of ['raw','subjective','objective','assessment','plan'])content[key]=content[key].replaceAll('La personne','Le parent').replaceAll('la personne','le parent');
 if(age<6)content.raw+=' Les mesures de séance sont renseignées par le parent.';
 for(const key of ['raw','subjective','objective','assessment','plan'])content[key]=content[key].replace(/\bde un\b/gu,'d’un').replace(/\bde une\b/gu,'d’une').replace(/\bde le\b/gu,'du').replace(/\bde les\b/gu,'des');
 return content;
}
export function createEvaluationPlan(patients,existing=[]){
 const start=Date.parse('2021-01-03T08:00:00Z'),cutoff=Date.parse('2026-10-01T00:00:00+01:00');
 const occupancy=new Map();
 for(const a of existing){const day=a.starts_at.slice(0,10);const slots=occupancy.get(day)??[];slots.push([Date.parse(a.starts_at),Date.parse(a.ends_at)]);occupancy.set(day,slots);}
 const slots=[8,8.5,9,9.5,10,10.5,13,13.5,14,14.5,15,15.5];
 function allocate(desired,duration){
  let day=Date.parse(new Date(Math.max(start,desired)).toISOString().slice(0,10)+'T00:00:00Z');
  for(;day<cutoff;day+=86400000){
   if([5,6].includes(new Date(day).getUTCDay()))continue;
   const key=new Date(day).toISOString().slice(0,10),busy=occupancy.get(key)??[];
   for(const hour of slots){const a=day+hour*3600000,b=a+duration*60000;
    if((hour<11&&b>day+11*3600000)||(hour>=13&&b>day+16*3600000))continue;
    if(busy.some(([c,d])=>a<d&&b>c))continue;
    busy.push([a,b]);occupancy.set(key,busy);return [new Date(a).toISOString(),new Date(b).toISOString()];
   }
  }throw Error('HistoricalScheduleCapacity');
 }
 const eligible=[],excluded=[],events=[];let long=0;
 patients.forEach((p,index)=>{
  const born=Date.parse(p.birth_date),now=Date.parse('2026-10-22T00:00:00+01:00');
  if(!Number.isFinite(born)||born>cutoff||now-born>120*31557600000){excluded.push({id:p.id,reason:born>cutoff?'future-birth-date':'inconsistent-birth-date'});return;}
  const adult=now-born>=18*31557600000,count=adult&&long<3?(long++,104):2+index%7;
  eligible.push({...p,index,count});
  const earliest=Math.max(start,born+30*86400000);
  if(earliest>=cutoff){excluded.push({id:p.id,reason:'no-past-slot-after-birth'});eligible.pop();return;}
  const first=earliest+((index*7919)%Math.max(1,Math.floor((cutoff-earliest)/86400000/3)))*86400000;
  const last=first+(cutoff-first-7*86400000)*(.60+((index*3571)%390)/1000);
  for(let position=0;position<count;position++){
   const desired=first+(last-first)*(position/(count-1||1));
   events.push({patient:p,index,position,count,desired:Math.max(earliest,desired)});
  }
 });
 events.sort((a,b)=>a.desired-b.desired||a.patient.id.localeCompare(b.patient.id)||a.position-b.position);
 const visits=events.map(e=>{const [at,end]=allocate(e.desired,e.position===0?60:30),key=`${e.patient.id}:${e.position}`;return {id:evaluationId('consultation',key),appointmentId:evaluationId('appointment',key),noteId:evaluationId('note',key),patient:e.patient,index:e.index,position:e.position,count:e.count,at,end,...visitContent({patientId:e.patient.id,index:e.index,position:e.position,count:e.count,birthDate:e.patient.birth_date,at})};});
 return {patients:eligible,excluded,visits};
}
