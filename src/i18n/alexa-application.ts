const timelineEventLabels:Readonly<Record<string,string>>={consultation:'Consultation',note:'Note clinique',diagnostic:'Diagnostic documenté',prescription:'Ordonnance',echelle:'Échelle',rdv:'Rendez-vous',document:'Document',traitement:'Traitement'};
const timelineEventPluralLabels:Readonly<Record<string,string>>={consultation:'consultations',note:'notes cliniques',diagnostic:'diagnostics documentés',prescription:'ordonnances',echelle:'échelles',rdv:'rendez-vous',document:'documents',traitement:'événements de traitement'};
export const applicationLabels:Record<string,string>={name:'Cabinet',address:'Adresse',phone:'Téléphone',full_name:'Nom professionnel',title:'Titre',speciality_fr:'Spécialité',speciality_ar:'Spécialité (arabe)',order_number:'N° d’Ordre',revenu_periode:'Recettes de la période',charges_periode:'Charges de la période',resultat_net_periode:'Résultat net de la période',nb_seances_periode:'Paiements encaissés de la période',panier_moyen:'Montant moyen par paiement encaissé',impayes_total:'Impayés connus, toutes dates',impayes_count:'Paiements impayés, toutes dates',revenu_aujourdhui:'Recettes aujourd’hui',revenu_semaine:'Recettes de la semaine',revenu_mois:'Recettes du mois',nb_charges_recurrentes:'Charges récurrentes',total_recurrent_mensuel:'Charges récurrentes, rythme mensuel',total_ponctuel_periode:'Charges ponctuelles de la période'};
const notificationKinds:Record<string,string>={payment_due:'Paiement à encaisser',patient_arrived:'Patient arrivé',pending_intake:'Demande à traiter'};
export const applicationReadCopy={
 receptionCount:(n:number,day:string,queue:string)=>queue==='waiting'?`${n} patient${n===1?'':'s'} en attente au ${day}.`:queue==='requests'?`${n} demande${n===1?'':'s'} web pour les soixante jours à partir du ${day}.`:queue==='payments'?`${n} paiement${n===1?'':'s'} créé${n===1?'':'s'} dans les dernières vingt-quatre heures à la date de lecture.`:`${n} rendez-vous pour la journée du ${day}.`,
 timelineRestriction:'Le filtrage de la chronologie par période ou par événements les plus anciens n’est pas pris en charge. Je peux présenter les événements visibles dans leur ordre chronologique.',
 periodClarification:'Je n’ai pas pu fixer cette période avec assez de précision pour limiter la lecture correctement. Peux-tu préciser les dates de début et de fin, avec leur année ?',
 extended:{receptionName:'Accueil',nextPage:'Dites « la suite » pour continuer cette liste.',empty:'Aucun résultat visible ne correspond à cette lecture.',catalogueLimit:'Les vingt premières références sont affichées ; précisez le nom pour affiner la recherche.',timeline:'Chronologie du dossier',timelineLimit:'La chronologie continue. Dites « la suite » pour remonter plus loin dans le dossier.',historySummaryLimit:'Ce résumé couvre les six consultations terminées les plus récentes ; les précédentes restent à parcourir.',events:timelineEventLabels,eventPlurals:timelineEventPluralLabels,timelineSummary:(from:string,to:string,events:readonly string[],shown:number,more:boolean)=>`${from===to?`Le ${from}`:`Du ${from} au ${to}`}, la chronologie comprend ${events.join(', ')}. Les ${shown} événements sont présentés du plus ancien au plus récent.${more?` Cette page couvre les événements les plus récents ; dites « la suite » pour remonter plus loin.`:''}`,medication:(name:string,inn:string,form:string|null,strength:string|null)=>[name,inn,form,strength].filter(Boolean).join(' — '),reception:(day:string,total:number,waiting:number,requests:number,payments:number)=>`Au ${day}, l’accueil présente ${total} rendez-vous, ${waiting} patients en attente, ${requests} demandes web sur les soixante jours à partir de cette date et ${payments} paiements créés dans les dernières vingt-quatre heures à la date de lecture.`},
 consultationCount:(n:number,status:unknown,patient=false)=>{
  const subject=patient?'Ce dossier':'Le cabinet',verb=patient?'contient':'compte',noun=`consultation${n===1?'':'s'}`;
  const qualifier=status==='closed'?(n===1?' terminée':' terminées'):status==='open'?' en cours':status==='unsigned'?(n===1?' non signée':' non signées'):(n===1?' enregistrée':' enregistrées');
  return n===0?`${subject} ne ${patient?'contient':'compte'} aucune consultation${status==='closed'?' terminée':status==='open'?' en cours':status==='unsigned'?' non signée':' enregistrée'}.`:`${subject} ${verb} ${new Intl.NumberFormat('fr-DZ').format(n)} ${noun}${qualifier}.`;
 },
 documentSearchUnsupported:'La recherche dans le contenu de tous les documents n’est pas prise en charge. Je peux lister les documents et lire le texte d’un document identifié ; aucun résultat filtré par contenu n’a été inventé.',
 office:{
  notifications:(total:number,unread:number)=>total===0&&unread===0?'Aucune notification n’est visible pour le moment.':unread===0?`Vous n’avez aucune notification non lue. ${total===1?'Une notification est visible.':`${total} notifications sont visibles.`}`:`Vous avez ${unread} ${unread===1?'notification non lue':'notifications non lues'} sur ${total} ${total===1?'notification visible':'notifications visibles'}.`,
  kind:(kind:string,total:number,unread:number)=>`${kind} : ${unread} non lue(s) sur ${total}.`,
  system:(environment:string,date:string,time:string)=>`Le déploiement est ${environment==='self-hosted'?'auto-hébergé':'en mode de développement synthétique'}. Au cabinet, nous sommes le ${date} à ${time} (heure d’Alger). Cette lecture ne contrôle pas l’état de chaque service.`,
  kinds:notificationKinds,
 },
 documentCoverage:(from:number,to:number,total:number,complete:boolean)=>`Texte enregistré : caractères ${from+1}-${to} / ${total}.${complete?' Lecture complète.':' Lecture partielle ; demandez « la suite du document ».'}`, 
 missing:'Non renseigné',unknown:'Non établi',currency:' DZD',chargePopulation:'Liste : charges récurrentes actives (toutes dates) et charges ponctuelles de cette période.',recordMissing:'Dossier non renseigné',notArrived:'Non enregistrée',adminMissing:'Non renseignées',appointmentName:'Rendez-vous',
 finance:{
  typeName:(key:string)=>key==='__non_rattache__'?'Paiement sans rendez-vous lié':key.replace(/_/gu,' ').replace(/^./u,c=>c.toLocaleUpperCase('fr')),

  currentClock:'Les indicateurs aujourd’hui/semaine/mois utilisent la date courante de la base ; les impayés portent sur toutes dates.',
  evolution:'Six mois se terminant au mois de la date courante de la base, indépendamment de la période demandée.',
  revenueTypes:'Recettes par type de consultation',chargeCategories:'Charges par catégorie',
  amounts:'Montants et parts calculés par la base ; aucun total déduit de cette liste.',
  revenue:'Recettes',charges:'Charges',net:'Résultat net',sessions:'paiements encaissés',pending:'présence d’un impayé',
  cashDates:'Calendrier des encaissements : date d’encaissement ; indicateur d’impayé : paiements encore impayés à la date de lecture, classés par date de création.',
  groupedTypes:'Nombre de paiements encaissés par jour et par type ; les types restants sont regroupés sous « autres » par la base.',
  attention:'Impayés toutes dates et au plus trois prochaines échéances affichées, à la date courante de la base ; aucune échéance passée incluse.',
  deadlineCap:'La porte limite la liste à trois échéances : la présence d’autres échéances n’est pas établie.',
  noDeadline:'Aucune échéance à venir dans ce panneau.',oldest:'Ancienneté du plus ancien impayé',days:'jour(s)',remaining:'jour(s) restant(s)',
  deadline:' ; échéance ',
 },
 period:(from:string,to:string)=>'Période du '+from+' au '+to+' inclus.',
 page:(from:number,to:number,total:number)=>'Liste partielle : '+from+'–'+to+' / '+total+'.',
 appointment:{started:'Début',duration:'Durée',minutes:'minutes',kind:'Type',status:'Statut',practitioner:'Praticien',source:'Source',arrived:'Arrivée',admin:'Notes administratives'},
} as const;
