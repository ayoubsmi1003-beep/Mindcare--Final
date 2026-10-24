import {describe,expect,it} from "vitest";
import {prepareInternalMessage} from "@/server/alexa/internal-message";

const patient={firstName:"Nadia",lastName:"Belkacem",recordNumber:"P-1016",idDocumentNumber:"113255751"};

describe("prepareInternalMessage",()=>{
 it("accepte un message opérationnel sans identité patient",()=>{
  const result=prepareInternalMessage("Le patient est arrivé et attend depuis 20 minutes.",patient);
  expect(result).toEqual({ok:true,body:"Le patient est arrivé et attend depuis 20 minutes."});
 });

 it("refuse le prénom ou le nom du patient",()=>{
  expect(prepareInternalMessage("Nadia est arrivée.",patient)).toEqual({ok:false,reason:"patient-data"});
  expect(prepareInternalMessage("Belkacem attend.",patient)).toEqual({ok:false,reason:"patient-data"});
 });

 it("refuse le numéro de dossier et la pièce d'identité",()=>{
  expect(prepareInternalMessage("Dossier P-1016 arrivé.",patient)).toEqual({ok:false,reason:"patient-data"});
  expect(prepareInternalMessage("Pièce 113255751 vérifiée.",patient)).toEqual({ok:false,reason:"patient-data"});
 });

 it("refuse un identifiant numérique recopié",()=>{
  expect(prepareInternalMessage("Dossier 12345678.",patient)).toEqual({ok:false,reason:"patient-data"});
 });

 it("refuse une donnée clinique même sans nom",()=>{
  expect(prepareInternalMessage("Le traitement est terminé.",patient)).toEqual({ok:false,reason:"clinical-data"});
  expect(prepareInternalMessage("Ordonnance prête.",patient)).toEqual({ok:false,reason:"clinical-data"});
 });

 it("refuse un message vide ou trop long",()=>{
  expect(prepareInternalMessage("  ",patient)).toEqual({ok:false,reason:"empty"});
  expect(prepareInternalMessage("x".repeat(1001),patient)).toEqual({ok:false,reason:"too-long"});
 });
});
