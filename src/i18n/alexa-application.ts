export const applicationLabels:Record<string,string>={name:'Cabinet',address:'Adresse',phone:'Téléphone',full_name:'Nom professionnel',title:'Titre',speciality_fr:'Spécialité',speciality_ar:'Spécialité (arabe)',order_number:'N° d’Ordre',revenu_periode:'Recettes de la période',charges_periode:'Charges de la période',resultat_net_periode:'Résultat net de la période',nb_seances_periode:'Séances de la période',panier_moyen:'Montant moyen par séance',impayes_total:'Impayés connus, toutes dates',impayes_count:'Paiements impayés, toutes dates',revenu_aujourdhui:'Recettes aujourd’hui',revenu_semaine:'Recettes de la semaine',revenu_mois:'Recettes du mois',nb_charges_recurrentes:'Charges récurrentes',total_recurrent_mensuel:'Charges récurrentes, rythme mensuel',total_ponctuel_periode:'Charges ponctuelles de la période'};
const notificationKinds:Record<string,string>={payment_due:'Paiement à encaisser',patient_arrived:'Patient arrivé',pending_intake:'Demande à traiter'};
export const applicationReadCopy={
 consultationCount:(n:number,status:unknown)=>`${n} consultation${n===1?'':'s'}${status==='closed'?(n===1?' terminée':' terminées'):status==='open'?' en cours':status==='unsigned'?(n===1?' non signée':' non signées'):''}.`,
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
  typeName:(key:string)=>key==='__non_rattache__'?'Séance non rattachée':key.replace(/_/gu,' ').replace(/^./u,c=>c.toLocaleUpperCase('fr')),

  currentClock:'Les indicateurs aujourd’hui/semaine/mois utilisent la date courante de la base ; les impayés portent sur toutes dates.',
  evolution:'Six mois se terminant au mois de la date courante de la base, indépendamment de la période demandée.',
  revenueTypes:'Recettes par type de consultation',chargeCategories:'Charges par catégorie',
  amounts:'Montants et parts calculés par la base ; aucun total déduit de cette liste.',
  revenue:'Recettes',charges:'Charges',net:'Résultat net',sessions:'séance(s)',pending:'présence d’un impayé',
  cashDates:'Calendrier des encaissements : date d’encaissement ; indicateur d’impayé : date de création du paiement.',
  groupedTypes:'Nombre de séances encaissées par jour et par type ; les types restants sont regroupés sous « autres » par la base.',
  attention:'Impayés toutes dates et au plus trois prochaines échéances affichées, à la date courante de la base ; aucune échéance passée incluse.',
  deadlineCap:'La porte limite la liste à trois échéances : la présence d’autres échéances n’est pas établie.',
  noDeadline:'Aucune échéance à venir dans ce panneau.',oldest:'Ancienneté du plus ancien impayé',days:'jour(s)',remaining:'jour(s) restant(s)',
  deadline:' ; échéance ',
 },
 period:(from:string,to:string)=>'Période du '+from+' au '+to+' inclus.',
 page:(from:number,to:number,total:number)=>'Liste partielle : '+from+'–'+to+' / '+total+'.',
 appointment:{started:'Début',duration:'Durée',minutes:'minutes',kind:'Type',status:'Statut',practitioner:'Praticien',source:'Source',arrived:'Arrivée',admin:'Notes administratives'},
} as const;
