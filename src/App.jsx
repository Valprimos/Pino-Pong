import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trophy, Crown, Plus, X, Check, Users, History, Swords, Ticket, RotateCcw, Loader2, Clock, Sun, Wind, Eye, EyeOff, Info, Trash2, Ban, BarChart2, Gift, Target, TrendingUp, TrendingDown, MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, onValue, set as dbSet } from "firebase/database";
import { firebaseConfig } from "./firebaseConfig";

// --- SINCRONIZACIÓN EN LA NUBE (Firebase) ---
// Esto hace que todos los amigos vean los mismos datos en tiempo real,
// sin importar desde qué móvil o navegador entren.
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const ESTADO_DB_REF = dbRef(db, "casaPingpongEstado");

const RATING_INICIAL = 1000;
const K_FACTOR = 32;

// --- NUEVO MOTOR MATEMÁTICO BASADO EN HISTORIAL REAL DE PUNTOS ---

function analizarImpactoContexto(historial, nombre, esLado, solEnContra, viento, esGM) {
  let ptsAFavor = 0, ptsEnContra = 0;
  let ptsAFavorCtx = 0, ptsEnContraCtx = 0;

  historial.forEach(m => {
    if (!m.teamA || !m.teamB || m.teamA.length !== 1 || m.teamB.length !== 1) return;
    const esA = m.teamA[0] === nombre;
    const esB = m.teamB[0] === nombre;
    if (!esA && !esB) return;

    const misPts = esA ? m.pa : m.pb;
    const susPts = esA ? m.pb : m.pa;
    const miLado = esA ? m.ladoA : m.ladoB;
    const teniaSol = m.solLado === miLado;

    ptsAFavor += misPts;
    ptsEnContra += susPts;

    // Si coincide el contexto que estamos evaluando
    let coincide = true;
    if (esLado && miLado !== esLado) coincide = false;
    if (solEnContra && !teniaSol) coincide = false;
    if (viento && !m.viento) coincide = false;
    if (esGM && !m.esGM) coincide = false;

    if (coincide) {
      ptsAFavorCtx += misPts;
      ptsEnContraCtx += susPts;
    }
  });

  const winRateGlobal = ptsAFavor / (ptsAFavor + ptsEnContra || 1);
  const winRateCtx = ptsAFavorCtx / (ptsAFavorCtx + ptsEnContraCtx || 1);

  // Suavizado para pocos datos (asumimos que rinde igual que el global hasta tener pruebas de lo contrario)
  const PESO_PRIOR = 40; 
  const winRateSuavizado = ((winRateCtx * (ptsAFavorCtx + ptsEnContraCtx)) + (winRateGlobal * PESO_PRIOR)) / ((ptsAFavorCtx + ptsEnContraCtx) + PESO_PRIOR);

  return winRateGlobal === 0 ? 1 : winRateSuavizado / winRateGlobal;
}

function calcularProbabilidadPuntoPura(historial, nombreA, nombreB, ctx) {
  let pA_H2H = 0, pB_H2H = 0;
  let pA_Global = 0, pContraA_Global = 0;
  let pB_Global = 0, pContraB_Global = 0;

  historial.forEach(m => {
    if (!m.teamA || !m.teamB || m.teamA.length !== 1 || m.teamB.length !== 1) return;
    const esAA = m.teamA[0] === nombreA, esAB = m.teamB[0] === nombreA;
    const esBA = m.teamA[0] === nombreB, esBB = m.teamB[0] === nombreB;

    if (esAA || esAB) {
       pA_Global += esAA ? m.pa : m.pb;
       pContraA_Global += esAA ? m.pb : m.pa;
    }
    if (esBA || esBB) {
       pB_Global += esBA ? m.pa : m.pb;
       pContraB_Global += esBA ? m.pb : m.pa;
    }

    if ((esAA && esBB) || (esAB && esBA)) {
       pA_H2H += esAA ? m.pa : m.pb;
       pB_H2H += esAA ? m.pb : m.pa;
    }
  });

  const winRateH2H = pA_H2H / (pA_H2H + pB_H2H || 1);
  const winRateGlobalA = pA_Global / (pA_Global + pContraA_Global || 1);
  const winRateGlobalB = pB_Global / (pB_Global + pContraB_Global || 1);
  const winRateGlobalCruzado = (winRateGlobalA + (1 - winRateGlobalB)) / 2;

  let pPuntoBase;
  const totalH2H = pA_H2H + pB_H2H;
  
  if (totalH2H >= 21) {
      // Prioridad 1: H2H manda (70% H2H, 20% Global, 10% Suavizado de realidad)
      pPuntoBase = (winRateH2H * 0.70) + (winRateGlobalCruzado * 0.20) + (0.5 * 0.10);
  } else if (pA_Global > 0 || pB_Global > 0) {
      // Prioridad 2: Historial Global 
      pPuntoBase = (winRateGlobalCruzado * 0.85) + (0.5 * 0.15);
  } else {
      // Prioridad 3: Sin datos (50/50)
      pPuntoBase = 0.5;
  }

  // Modificadores de contexto individualizados
  const modLadoA = ctx.ladoA ? analizarImpactoContexto(historial, nombreA, ctx.ladoA, false, false, false) : 1;
  const modSolA = ctx.solLado === ctx.ladoA ? analizarImpactoContexto(historial, nombreA, null, true, false, false) : 1;
  const modVientoA = ctx.viento ? analizarImpactoContexto(historial, nombreA, null, false, true, false) : 1;
  const modGmA = ctx.esGM ? analizarImpactoContexto(historial, nombreA, null, false, false, true) : 1;

  const modLadoB = ctx.ladoB ? analizarImpactoContexto(historial, nombreB, ctx.ladoB, false, false, false) : 1;
  const modSolB = ctx.solLado === ctx.ladoB ? analizarImpactoContexto(historial, nombreB, null, true, false, false) : 1;
  const modVientoB = ctx.viento ? analizarImpactoContexto(historial, nombreB, null, false, true, false) : 1;
  const modGmB = ctx.esGM ? analizarImpactoContexto(historial, nombreB, null, false, false, true) : 1;

  const multiA = modLadoA * modSolA * modVientoA * modGmA;
  const multiB = modLadoB * modSolB * modVientoB * modGmB;

  let pFinalA = pPuntoBase * multiA;
  let pFinalB = (1 - pPuntoBase) * multiB;

  return Math.min(0.95, Math.max(0.05, pFinalA / (pFinalA + pFinalB))); 
}

function calcularMovMulti(pa, pb) {
  const diff = Math.abs(pa - pb);
  if (diff === 0) return 1;
  return Math.log(diff + Math.E - 1);
}

function expectedScore(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function isParcial(a, b) {
  return (a === 7 && b === 0) || (a === 0 && b === 7) ||
         (a === 9 && b === 1) || (a === 1 && b === 9) ||
         (a === 11 && b === 2) || (a === 2 && b === 11) ||
         (a === 21 && b <= 2) || (b === 21 && a <= 2);
}

function isValidScore(a, b) {
  if (a < 0 || b < 0) return false;
  if ((a === 21 && b <= 19) || (b === 21 && a <= 19)) return true;
  if (a >= 20 && b >= 20 && Math.abs(a - b) === 2) return true;
  return isParcial(a, b);
}

function calcularTerminales(pA) {
  const dp = Array(35).fill(0).map(() => Array(35).fill(0));
  dp[0][0] = 1;
  const pB = 1 - pA;
  const term = [];

  for(let a = 0; a < 32; a++) {
      for(let b = 0; b < 32; b++) {
          if (dp[a][b] === 0) continue;
          if (isValidScore(a, b)) {
              term.push({ a, b, p: dp[a][b] });
          } else {
              if (a + 1 < 35) dp[a + 1][b] += dp[a][b] * pA;
              if (b + 1 < 35) dp[a][b + 1] += dp[a][b] * pB;
          }
      }
  }
  return term;
}

// CAP DE CUOTAS LIMITADO A LA REALIDAD
function cuota(p, margen) {
  const pSegura = Math.max(0.004, p); // Suelo real de posibilidad
  const conMargen = (1 / pSegura) / (1 + margen);
  return Number(Math.max(1.05, Math.min(250.00, conMargen)).toFixed(2));
}

function calcularMercadosDesdeProbabilidad(pA_punto, margen, nombreA, nombreB) {
  let terminales = calcularTerminales(pA_punto);
  
  let pGanaA = 0, pGanaB = 0;
  let expA = 0, expB = 0;
  let probParciales = 0, probAjustado = 0, probNormal = 0;

  terminales.forEach(t => {
      if (t.a > t.b) pGanaA += t.p;
      else pGanaB += t.p;
      
      expA += t.a * t.p;
      expB += t.b * t.p;

      if (isParcial(t.a, t.b)) probParciales += t.p;
      else if (t.a >= 22 || t.b >= 22) probAjustado += t.p;
      else probNormal += t.p;
  });

  const ganador = { A: cuota(pGanaA, margen), B: cuota(pGanaB, margen), pA: pGanaA, pB: pGanaB };

  const comoTermina = {
    parciales: cuota(probParciales, margen),
    normal: cuota(probNormal, margen),
    ajustado: cuota(probAjustado, margen),
  };

  const handicaps = [3, 6, 10].map(k => {
      let pHandA = 0, pHandB = 0;
      terminales.forEach(t => {
          if (t.a - t.b >= k) pHandA += t.p;
          if (t.b - t.a >= k) pHandB += t.p;
      });
      return { k, cuotaA: cuota(pHandA, margen), cuotaB: cuota(pHandB, margen) };
  });

  const lineaA = Math.max(3.5, Math.floor(expA) + 0.5);
  const lineaB = Math.max(3.5, Math.floor(expB) + 0.5);

  let pMasA = 0, pMasB = 0;
  terminales.forEach(t => {
      if (t.a > lineaA) pMasA += t.p;
      if (t.b > lineaB) pMasB += t.p;
  });

  const puntosA = { linea: lineaA, cuotaMas: cuota(pMasA, margen), cuotaMenos: cuota(1-pMasA, margen) };
  const puntosB = { linea: lineaB, cuotaMas: cuota(pMasB, margen), cuotaMenos: cuota(1-pMasB, margen) };

  const resultadosExactos = [
    { marcador: `21-12`, p: terminales.find(t => t.a === 21 && t.b === 12)?.p || 0 },
    { marcador: `21-15`, p: terminales.find(t => t.a === 21 && t.b === 15)?.p || 0 },
    { marcador: `21-19`, p: terminales.find(t => t.a === 21 && t.b === 19)?.p || 0 },
    { marcador: `12-21`, p: terminales.find(t => t.a === 12 && t.b === 21)?.p || 0 },
    { marcador: `15-21`, p: terminales.find(t => t.a === 15 && t.b === 21)?.p || 0 },
    { marcador: `19-21`, p: terminales.find(t => t.a === 19 && t.b === 21)?.p || 0 },
  ].map(res => ({ marcador: res.marcador, cuota: cuota(res.p, margen) }));

  return { ganador, handicaps, puntosA, puntosB, esperadoA: expA, esperadoB: expB, comoTermina, resultadosExactos, terminales };
}

const TOPE_AJUSTE_DINERO = 0.15;
const SENSIBILIDAD_DINERO = 0.32;
const VOLUMEN_DE_REFERENCIA = 200;

function ajusteBancaPorDinero(stakeA, stakeB) {
  const total = stakeA + stakeB;
  if (total <= 0) return 0;
  const fA = stakeA / total;
  const pesoVolumen = Math.min(1, total / VOLUMEN_DE_REFERENCIA);
  const bruto = (fA - 0.5) * SENSIBILIDAD_DINERO;
  return Math.max(-TOPE_AJUSTE_DINERO, Math.min(TOPE_AJUSTE_DINERO, bruto)) * pesoVolumen;
}

function cuotaGanadorConDinero(pA, margen, stakeA, stakeB) {
  const ajuste = ajusteBancaPorDinero(stakeA, stakeB);
  const pAAj = Math.min(0.97, Math.max(0.03, pA + ajuste));
  return { A: cuota(pAAj, margen), B: cuota(1 - pAAj, margen), ajuste };
}

function sumaStakeGanador(apuestas, nombre) {
  let total = 0;
  apuestas.forEach((ap) => {
    if (ap.tipo === "combinada") {
      if (ap.patas.some((p) => p.mercado === "Ganador" && p.seleccion === nombre)) total += ap.stake;
    } else if (ap.mercado === "Ganador" && ap.seleccion === nombre) {
      total += ap.stake;
    }
  });
  return total;
}

function claveBoost(mercado, seleccion) {
  return `${mercado}||${seleccion}`;
}
function boostDe(partido, mercado, seleccion) {
  const v = partido?.boosts?.[claveBoost(mercado, seleccion)];
  if (v === "LOCKED") return "LOCKED";
  return (typeof v === "number" && v >= 1.05) ? v : null;
}

function ladoConSentido(cuotaMas, cuotaMenos) {
  const CASI_SEGURO = 1.10;
  const masEsSeguro = cuotaMas <= CASI_SEGURO;
  const menosEsSeguro = cuotaMenos <= CASI_SEGURO;
  if (masEsSeguro && menosEsSeguro) return { mostrarMas: true, mostrarMenos: true };
  if (masEsSeguro) return { mostrarMas: false, mostrarMenos: true };
  if (menosEsSeguro) return { mostrarMas: true, mostrarMenos: false };
  return { mostrarMas: true, mostrarMenos: true };
}

function evaluarPata(mercado, seleccion, ctx, customResults = {}) {
  const { ganador, pa, pb, nombreA, nombreB } = ctx;
  
  if (customResults[`${mercado}||${seleccion}`] !== undefined) {
      return customResults[`${mercado}||${seleccion}`];
  }

  const margen = Math.abs(pa - pb);
  if (mercado === "Ganador") return seleccion === ganador;
  if (mercado === "Resultado Exacto Partido") return seleccion === `${pa}-${pb}`;
  
  if (mercado.startsWith("Puntos Exactos")) {
    const jug = mercado.replace("Puntos Exactos ", "");
    const val = Number(seleccion);
    if (jug === nombreA) return pa === val;
    if (jug === nombreB) return pb === val;
  }

  if (mercado.startsWith("Hándicap")) {
    const k = Number(mercado.match(/(\d+)/)[1]);
    return seleccion === ganador && margen >= k;
  }
  if (mercado.startsWith("Puntos")) {
    const m = mercado.match(/^Puntos (.+) ([\d.]+)$/);
    if(m) {
      const jugadorRef = m[1];
      const linea = Number(m[2]);
      const puntosJ = jugadorRef === nombreA ? pa : pb;
      return seleccion === "Más" ? puntosJ > linea : puntosJ < linea;
    }
  }
  if (mercado === "Cómo termina") {
    const ganoA = pa > pb;
    const winnerScore = ganoA ? pa : pb;
    const loserScore = ganoA ? pb : pa;
    if (seleccion === "parciales") return isParcial(pa, pb);
    if (seleccion === "ajustado") return winnerScore >= 22;
    if (seleccion === "normal") return winnerScore === 21 && loserScore >= 3 && loserScore <= 19;
  }
  return false;
}

const isCustom = (m) => !["Ganador", "Resultado Exacto Partido", "Cómo termina"].includes(m) && !m.startsWith("Puntos Exactos") && !m.startsWith("Hándicap") && !m.startsWith("Puntos ");

function sonContradictorias(a, b, partido) {
  if (!partido) return false;
  if (isCustom(a.mercado) || isCustom(b.mercado)) {
      return (a.mercado === b.mercado && a.seleccion !== b.seleccion);
  }
  
  const allResultados = [];
  for(let pa=0; pa<=35; pa++){
    for(let pb=0; pb<=35; pb++){
       if(isValidScore(pa,pb)) allResultados.push({pa, pb});
    }
  }

  let vecesGananAmbas = 0;
  for (const r of allResultados) {
    const ctx = { ganador: r.pa > r.pb ? partido.a : partido.b, pa: r.pa, pb: r.pb, nombreA: partido.a, nombreB: partido.b };
    if (evaluarPata(a.mercado, a.seleccion, ctx, {}) && evaluarPata(b.mercado, b.seleccion, ctx, {})) {
        vecesGananAmbas++;
    }
  }
  return vecesGananAmbas === 0;
}

// LOGICA DE SGP REESCRITA Y PROTEGIDA
function calcularCuotaSGP(slip, mercados, partido, margen) {
  if (slip.length === 0) return 1.05;
  if (!mercados || !partido) return slip.reduce((a, b) => a * (b.cuota || 1), 1);
  
  const customLegs = slip.filter(s => isCustom(s.mercado));
  const stdLegs = slip.filter(s => !isCustom(s.mercado));
  
  let cuotaStd = 1.05;
  if (stdLegs.length > 0) {
      let probConjunta = 0;
      mercados.terminales.forEach(t => {
          const ctx = { ganador: t.a > t.b ? partido.a : partido.b, pa: t.a, pb: t.b, nombreA: partido.a, nombreB: partido.b };
          if (stdLegs.every(leg => evaluarPata(leg.mercado, leg.seleccion, ctx, {}))) {
              probConjunta += t.p;
          }
      });
      
      const cuotaTeorica = cuota(probConjunta, margen);
      const productoIrreal = stdLegs.reduce((acc, leg) => acc * leg.cuota, 1);
      const maximaIndividual = stdLegs.reduce((max, leg) => Math.max(max, leg.cuota), 1);

      // BLINDAJE 1: La cuota SGP jamás puede superar el producto bruto de las cuotas
      // BLINDAJE 2: La cuota SGP jamás puede ser MENOR que apostar a la opción más difícil por separado.
      cuotaStd = Math.max(maximaIndividual, Math.min(productoIrreal, cuotaTeorica));
  }
  
  const cuotaCust = customLegs.reduce((a, b) => a * b.cuota, 1);
  return Math.max(1.05, cuotaStd * cuotaCust);
}

function probPuntosIndividual(terminales, pts, isA) {
    let p = 0;
    terminales.forEach(t => {
      if ((isA && t.a === pts) || (!isA && t.b === pts)) p += t.p;
    });
    return p;
  }
  
function probDesdeTerminales(terminales, pa, pb) {
    const t = terminales.find(t => t.a === pa && t.b === pb);
    return t ? t.p : 0;
}

function calcularEstadisticasGlobales(historial) {
  let canastaTot = 0, columpiosTot = 0, solMataJugador = 0, solTot = 0, vientoV = 0, vientoTot = 0;
  const porJugador = {};

  historial.forEach(m => {
    if (!m.teamA || !m.teamB || m.teamA.length !== 1 || m.teamB.length !== 1) return;
    const aLabel = m.teamA[0];
    const bLabel = m.teamB[0];
    
    if (!porJugador[aLabel]) porJugador[aLabel] = { cV:0, cD:0, kV:0, kD:0, solV:0, solD:0, solRivalV:0, solRivalD:0, vientoV:0, vientoD:0, upsetV:0, upsetD:0, favV:0, favD:0 };
    if (!porJugador[bLabel]) porJugador[bLabel] = { cV:0, cD:0, kV:0, kD:0, solV:0, solD:0, solRivalV:0, solRivalD:0, vientoV:0, vientoD:0, upsetV:0, upsetD:0, favV:0, favD:0 };

    const ganador = m.ganador;
    const ganoA = ganador === aLabel;
    
    const eloA = m.ratingsAntes?.[aLabel] || 1000;
    const eloB = m.ratingsAntes?.[bLabel] || 1000;
    if (ganoA) {
       if (eloA < eloB) { porJugador[aLabel].upsetV++; porJugador[bLabel].favD++; }
       else { porJugador[aLabel].favV++; porJugador[bLabel].upsetD++; }
    } else {
       if (eloB < eloA) { porJugador[bLabel].upsetV++; porJugador[aLabel].favD++; }
       else { porJugador[bLabel].favV++; porJugador[aLabel].upsetD++; }
    }

    if (m.ladoA === "Canasta") { ganoA ? porJugador[aLabel].cV++ : porJugador[aLabel].cD++; canastaTot += ganoA ? 1 : 0; }
    else if (m.ladoA === "Columpios") { ganoA ? porJugador[aLabel].kV++ : porJugador[aLabel].kD++; columpiosTot += ganoA ? 1 : 0; }

    if (m.ladoB === "Canasta") { !ganoA ? porJugador[bLabel].cV++ : porJugador[bLabel].cD++; canastaTot += !ganoA ? 1 : 0; }
    else if (m.ladoB === "Columpios") { !ganoA ? porJugador[bLabel].kV++ : porJugador[bLabel].kD++; columpiosTot += !ganoA ? 1 : 0; }

    if (m.solLado) {
      if (m.solLado === m.ladoA) { 
         ganoA ? porJugador[aLabel].solV++ : porJugador[aLabel].solD++; 
         ganoA ? porJugador[bLabel].solRivalD++ : porJugador[bLabel].solRivalV++;
         solTot++; if(!ganoA) solMataJugador++;
      }
      if (m.solLado === m.ladoB) { 
         !ganoA ? porJugador[bLabel].solV++ : porJugador[bLabel].solD++; 
         !ganoA ? porJugador[aLabel].solRivalD++ : porJugador[aLabel].solRivalV++;
         solTot++; if(ganoA) solMataJugador++;
      }
    }

    if (m.viento) {
        ganoA ? porJugador[aLabel].vientoV++ : porJugador[aLabel].vientoD++;
        !ganoA ? porJugador[bLabel].vientoV++ : porJugador[bLabel].vientoD++;
        vientoTot += 2;
        vientoV++;
    }
  });

  return { totales: { canasta: canastaTot, columpios: columpiosTot, solMataJugador, solTot, vientoV, vientoTot }, porJugador };
}

function actualizarTitulo(gm, pendiente, esGM, ganador) {
  if (!esGM) return { gm, pendiente };
  if (ganador === gm) return { gm, pendiente: null };
  if (pendiente === ganador) return { gm: ganador, pendiente: null };
  return { gm, pendiente: ganador };
}

function actualizarEloEquipo(ratingsA, ladoA, ratingsB, ladoB, ganoA, pa, pb) {
  const avgA = ratingsA.reduce((s, r) => s + r, 0) / ratingsA.length;
  const avgB = ratingsB.reduce((s, r) => s + r, 0) / ratingsB.length;
  const pA = expectedScore(avgA, avgB);
  const pB = 1 - pA;
  const sA = ganoA ? 1 : 0, sB = ganoA ? 0 : 1;
  
  const movAjuste = calcularMovMulti(pa, pb);

  return { 
    deltaA: K_FACTOR * movAjuste * (sA - pA), 
    deltaB: K_FACTOR * movAjuste * (sB - pB) 
  };
}

function construirRegistrosH2H(historial) {
  const registros = {};
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    const [a] = p.teamA, [b] = p.teamB;
    const ratingA = p.ratingsAntes?.[a] ?? RATING_INICIAL;
    const ratingB = p.ratingsAntes?.[b] ?? RATING_INICIAL;
    const pEloA = expectedScore(ratingA, ratingB);
    const ganoA = p.pa > p.pb;
    const movMulti = calcularMovMulti(p.pa, p.pb);

    if (!registros[a]) registros[a] = {};
    if (!registros[a][b]) registros[a][b] = [];
    registros[a][b].push({ gano: ganoA, pElo: pEloA, mov: movMulti, partido: p });
    
    if (!registros[b]) registros[b] = {};
    if (!registros[b][a]) registros[b][a] = [];
    registros[b][a].push({ gano: !ganoA, pElo: 1 - pEloA, mov: movMulti, partido: p });
  });
  return registros;
}

function calcularRacha(historial, nombre) {
  let racha = 0;
  let signo = null;
  for (const p of historial) {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) continue;
    const esA = p.teamA[0] === nombre;
    const esB = p.teamB[0] === nombre;
    if (!esA && !esB) continue;
    const gano = esA ? p.pa > p.pb : p.pb > p.pa;
    if (signo === null) { signo = gano; racha = 1; continue; }
    if (gano === signo) racha++;
    else break;
  }
  if (signo === null) return 0;
  return signo ? racha : -racha;
}

function construirPerfilJugador(historial, nombre) {
  const registrosH2H = construirRegistrosH2H(historial);
  const h2h = {};
  Object.entries(registrosH2H[nombre] || {}).forEach(([rival, list]) => {
    h2h[rival] = { 
      n: list.length, 
      victorias: list.filter((r) => r.gano).length,
      partidos: list.map(r => r.partido)
    };
  });

  const partidos = historial.filter((p) => p.teamA && p.teamB && (p.teamA.includes(nombre) || p.teamB.includes(nombre)));

  return {
    racha: calcularRacha(historial, nombre),
    h2h,
    ultimos: partidos.slice(0, 5),
  };
}

function calcularEstadisticasApostantes(historial, bettors) {
  const stats = {};
  Object.keys(bettors).forEach((n) => { stats[n] = { total: 0, aciertos: 0 }; });
  historial.forEach((p) => {
    (p.apuestas || []).forEach((ap) => {
      if (!stats[ap.bettor]) stats[ap.bettor] = { total: 0, aciertos: 0 };
      stats[ap.bettor].total += 1;
      if (ap.estado === "ganada") stats[ap.bettor].aciertos += 1;
    });
  });
  return stats;
}

function calcularRachaApuestas(historial, bettor) {
  let racha = 0;
  for (const p of historial) {
    const propias = (p.apuestas || []).filter((a) => a.bettor === bettor);
    for (const ap of propias) {
      if (ap.estado === "ganada") racha++;
      else return racha;
    }
  }
  return racha;
}

function bonusPorRachaApostante(racha) {
  if (racha >= 5) return 1.15;
  if (racha >= 3) return 1.08;
  return 1;
}

function generarTitular(p, coronacion, rachaRota) {
  const ganoA = p.pa > p.pb;
  const ganador = ganoA ? p.aLabel : p.bLabel;
  const perdedor = ganoA ? p.bLabel : p.aLabel;
  const margen = Math.abs(p.pa - p.pb);
  const marcador = `${p.pa}-${p.pb}`;
  const frasesCondicion = [];
  if (p.viento) frasesCondicion.push("pese al viento");
  if (p.solLado) frasesCondicion.push(`con el sol molestando en ${p.solLado}`);

  let base;
  if (p.pa > 21 || p.pb > 21) {
    base = `${ganador} sufre pero tumba a ${perdedor} en un ajustadísimo ${marcador}`;
  } else if (margen >= 15 || isParcial(p.pa, p.pb)) {
    base = `${ganador} arrasa a ${perdedor} (${marcador})`;
  } else if (margen <= 4) {
    base = `${ganador} se impone por la mínima a ${perdedor}, ${marcador}`;
  } else {
    base = `${ganador} vence a ${perdedor} por ${marcador}`;
  }
  if (frasesCondicion.length) base += " " + frasesCondicion.join(" y ");
  if (rachaRota) base = `${ganador} frena la racha de ${perdedor} — ${base}`;
  if (coronacion) base = `👑 ¡${ganador} ES EL NUEVO GRAN MAESTRO! ${base}`;
  return base + ".";
}

function calcularRankingEstilo(historial) {
  const porJugador = {};
  const ensure = (n) => { if (!porJugador[n]) porJugador[n] = { parciales: 0, deuceJugados: 0, deuceGanados: 0 }; };
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    const [a] = p.teamA, [b] = p.teamB;
    const ganoA = p.pa > p.pb;
    const ganador = ganoA ? a : b;
    const esDeuce = p.pa >= 22 || p.pb >= 22;
    ensure(a); ensure(b);
    if (isParcial(p.pa, p.pb)) porJugador[ganador].parciales += 1;
    if (esDeuce) {
      porJugador[a].deuceJugados += 1; porJugador[b].deuceJugados += 1;
      porJugador[ganador].deuceGanados += 1;
    }
  });
  const top = (campo, minimo) => Object.entries(porJugador)
    .filter(([, v]) => (campo === "deuce" ? v.deuceJugados >= minimo : v[campo] >= minimo))
    .sort((x, y) => (campo === "deuce" ? (y[1].deuceGanados / y[1].deuceJugados) - (x[1].deuceGanados / x[1].deuceJugados) : y[1][campo] - x[1][campo]))[0];
  return {
    reyParciales: top("parciales", 1),
    reyDeuce: top("deuce", 1),
    porJugador,
  };
}

function historialACSV(historial) {
  const filas = [["Fecha", "Hora", "JugadorA", "JugadorB", "PuntosA", "PuntosB", "Ganador", "CampoA", "CampoB", "Sol", "Viento", "GranMaestria"]];
  historial.forEach((p) => {
    filas.push([
      new Date(p.fecha).toLocaleDateString("es-ES"), p.hora || "",
      p.aLabel, p.bLabel, p.pa, p.pb, p.ganador,
      p.ladoA || "", p.ladoB || "", p.solLado || "no", p.viento ? "sí" : "no", p.esGM ? "sí" : "no",
    ]);
  });
  return filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function descargarCSV(contenido, nombreArchivo) {
  const blob = new Blob(["\uFEFF" + contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const ESTADO_DEFECTO = {
  jugadores: {}, gm: null, pendiente: null, margen: 0.08,
  bettors: {}, partidoAbierto: null, historial: [], vetados: [],
};

// Se suscribe a los cambios del estado compartido en Firebase.
// `callback` se llama con el estado cada vez que cambia (el propio o el de otro amigo).
function suscribirEstado(callback) {
  return onValue(
    ESTADO_DB_REF,
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : null),
    (error) => { console.error("Error leyendo estado de Firebase", error); callback(null); }
  );
}

async function guardarEstado(estado) {
  try { await dbSet(ESTADO_DB_REF, estado); }
  catch (e) { console.error("Error guardando estado en Firebase", e); }
}

const HISTORIAL_REAL = [
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 16, pb: 21, esGM: true },
  { teamA: ["Nicolás"], teamB: ["Javier"], pa: 5, pb: 21 },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19 },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 13 },
  { teamA: ["Nicolás"], teamB: ["Carlos (tío)"], pa: 21, pb: 15 },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 12, esGM: true },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 15, esGM: true, ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", hora: "12:00" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: true, ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", hora: "12:10" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, esGM: true, ladoA: "Columpios", ladoB: "Canasta", solLado: "Canasta", hora: "12:20" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, esGM: true, ladoA: "Columpios", ladoB: "Canasta", solLado: "Canasta", hora: "12:30" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 19, pb: 21, esGM: true, ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", hora: "12:40" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 15, pb: 21, esGM: true, ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", hora: "12:50" },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 22, pb: 20, ladoA: "Columpios", ladoB: "Canasta", hora: "19:20" },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 21, pb: 17, ladoA: "Columpios", ladoB: "Canasta", hora: "19:30" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 9, ladoA: "Columpios", ladoB: "Canasta", hora: "19:40" },
  { teamA: ["Javier"], teamB: ["Juan"], pa: 21, pb: 12, ladoA: "Columpios", ladoB: "Canasta", hora: "19:50" },
  { teamA: ["Juan", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 21, pb: 19, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "20:00" },
  { teamA: ["Juan", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 18, pb: 21, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "20:10" },
  { teamA: ["Daniel", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 17, pb: 21, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "20:20" },
  { teamA: ["Alberto"], teamB: ["Álvaro"], pa: 19, pb: 21, ladoA: "Canasta", ladoB: "Columpios", viento: true, hora: "14:00" },
  { teamA: ["Pedro"], teamB: ["Álvaro"], pa: 18, pb: 21, ladoA: "Canasta", ladoB: "Columpios", viento: true, hora: "14:10" },
  { teamA: ["Juan"], teamB: ["Álvaro"], pa: 15, pb: 21, ladoA: "Canasta", ladoB: "Columpios", viento: true, hora: "14:20" },
  { teamA: ["Nicolás"], teamB: ["Alberto"], pa: 19, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "14:40" },
  { teamA: ["Juan"], teamB: ["Alberto"], pa: 21, pb: 13, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "14:50" },
  { teamA: ["Pedro"], teamB: ["Alberto"], pa: 21, pb: 18, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "15:00" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 16, pb: 21, esGM: true, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "18:50" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 23, pb: 21, esGM: true, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: true, hora: "19:00" },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 25, pb: 23, esGM: true, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "19:10" },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 22, pb: 20, esGM: true, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "19:20" },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 21, pb: 12, esGM: true, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "19:20" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 16, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "18:30" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 19, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "18:40" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 16, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "18:50" },
  { teamA: ["Javier"], teamB: ["Pedro"], pa: 9, pb: 1, ladoA: "Columpios", ladoB: "Canasta", hora: "19:00" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 17, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:00" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 18, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:10" },
  { teamA: ["Pedro"], teamB: ["Jorge"], pa: 14, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:20" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 15, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "19:30" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 15, ladoA: "Columpios", ladoB: "Canasta", hora: "19:40" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, ladoA: "Columpios", ladoB: "Canasta", hora: "19:50" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 22, pb: 20, ladoA: "Columpios", ladoB: "Canasta", hora: "20:00" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 18, ladoA: "Columpios", ladoB: "Canasta", hora: "20:10" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 22, pb: 20, ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", hora: "12:20" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, ladoA: "Canasta", ladoB: "Columpios", hora: "12:30" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 14, ladoA: "Canasta", ladoB: "Columpios", hora: "12:40" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 23, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "12:50" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 19, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "13:00" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 18, ladoA: "Canasta", ladoB: "Columpios", hora: "13:10" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: true, ladoA: "Columpios", ladoB: "Canasta", hora: "13:20" },
  { teamA: ["Nicolás"], teamB: ["Pedro"], pa: 22, pb: 20, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: true, hora: "18:30" },
  { teamA: ["Álvaro"], teamB: ["Nicolás"], pa: 21, pb: 19, ladoA: "Columpios", ladoB: "Canasta", viento: true },
  { teamA: ["Álvaro"], teamB: ["Javier"], pa: 14, pb: 21, ladoA: "Columpios", ladoB: "Canasta", viento: true },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 13, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: true },
  { teamA: ["Pedro"], teamB: ["Jorge"], pa: 13, pb: 21, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 11, pb: 21, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 16, esGM: true, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios" },
  { teamA: ["Javier"], teamB: ["Pedro"], pa: 9, pb: 1, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 15, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:40" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 14, ladoA: "Canasta", ladoB: "Columpios", hora: "19:50" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 18, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:57" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 11, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "19:57" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 18, ladoA: "Canasta", ladoB: "Columpios", hora: "19:57" },
  { teamA: ["Juan"], teamB: ["Álvaro"], pa: 14, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "20:49" },
  { teamA: ["Juan"], teamB: ["Álvaro"], pa: 16, pb: 21, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "20:49" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 21, pb: 19, ladoA: "Columpios", ladoB: "Canasta", hora: "03:55" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 21, pb: 14, ladoA: "Columpios", ladoB: "Canasta", hora: "12:41" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 15, pb: 21, ladoA: "Columpios", ladoB: "Canasta", viento: true, hora: "12:50" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 8, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "12:55" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 16, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "13:01" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 9, pb: 1, ladoA: "Columpios", ladoB: "Canasta", hora: "13:03" },
  { teamA: ["Nicolás"], teamB: ["Pedro"], pa: 21, pb: 18, ladoA: "Canasta", ladoB: "Columpios", hora: "18:36" },
  { teamA: ["Nicolás"], teamB: ["Álvaro"], pa: 14, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "18:48" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 10, ladoA: "Canasta", ladoB: "Columpios", hora: "18:54" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 13, ladoA: "Columpios", ladoB: "Canasta", hora: "18:59" },
  { teamA: ["Jorge"], teamB: ["Pedro"], pa: 21, pb: 19, ladoA: "Columpios", ladoB: "Canasta", hora: "19:13" },
  { teamA: ["Álvaro"], teamB: ["Javier"], pa: 21, pb: 15, ladoA: "Columpios", ladoB: "Canasta", hora: "12:35" },
  { teamA: ["Álvaro"], teamB: ["Javier"], pa: 13, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "12:44" },
  { teamA: ["Álvaro"], teamB: ["Javier"], pa: 12, pb: 21, ladoA: "Columpios", ladoB: "Canasta", hora: "12:50" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 19, esGM: true, ladoA: "Columpios", ladoB: "Canasta", hora: "00:00" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 8, ladoA: "Columpios", ladoB: "Canasta", hora: "13:00" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 19, pb: 21, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "19:18" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 23, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "19:18" },
  { teamA: ["Álvaro"], teamB: ["Juan"], pa: 9, pb: 1, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "19:36" },
  { teamA: ["Pedro"], teamB: ["Álvaro"], pa: 21, pb: 17, ladoA: "Columpios", ladoB: "Canasta", hora: "19:37" },
  { teamA: ["Javier"], teamB: ["Pedro"], pa: 21, pb: 6, ladoA: "Canasta", ladoB: "Columpios", hora: "19:41" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 16, esGM: true, ladoA: "Columpios", ladoB: "Canasta", hora: "19:41" },
  { teamA: ["Jorge"], teamB: ["Juan"], pa: 7, pb: 0, ladoA: "Columpios", ladoB: "Canasta", hora: "19:58" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 9, ladoA: "Columpios", ladoB: "Canasta", hora: "20:03" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 19, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "20:05" },
  { teamA: ["Jorge"], teamB: ["Juan"], pa: 21, pb: 9, ladoA: "Columpios", ladoB: "Canasta", hora: "20:12" },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 15, ladoA: "Columpios", ladoB: "Canasta", hora: "20:21" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 8, ladoA: "Columpios", ladoB: "Canasta", hora: "20:22" },
  { teamA: ["David"], teamB: ["Jorge"], pa: 1, pb: 9, ladoA: "Canasta", ladoB: "Columpios", hora: "20:28" },
  { teamA: ["Juan"], teamB: ["Jorge"], pa: 17, pb: 21, ladoA: "Canasta", ladoB: "Columpios", hora: "20:36" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 21, pb: 23, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "20:36" },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 15, pb: 21, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "20:36" },
  { teamA: ["Jorge"], teamB: ["David"], pa: 9, pb: 1, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "20:52" },
  { teamA: ["Jorge"], teamB: ["Juan"], pa: 7, pb: 0, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "20:52" },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 21, pb: 16, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "21:00" },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 25, pb: 23, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "21:00" },
  { teamA: ["Javier"], teamB: ["David"], pa: 11, pb: 2, ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", hora: "21:00" },
  { teamA: ["Juan"], teamB: ["Javier"], pa: 2, pb: 11, ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", hora: "21:10" },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 23, esGM: true, ladoA: "Canasta", ladoB: "Columpios", hora: "21:15" },
];

function construirEstadoDesdeHistorialReal() {
  let jugadores = {};
  let gm = "Jorge";
  let pendiente = null;
  const historial = [];
  HISTORIAL_REAL.forEach((m, idx) => {
    const equipoA = m.teamA, equipoB = m.teamB;
    [...equipoA, ...equipoB].forEach((n) => { if (jugadores[n] === undefined) jugadores[n] = RATING_INICIAL; });
    const ratingsAntes = {};
    [...equipoA, ...equipoB].forEach((n) => { ratingsAntes[n] = jugadores[n]; });

    const ganoA = m.pa > m.pb;
    let deltaA, deltaB;
    
    const movMulti = calcularMovMulti(m.pa, m.pb);

    if (equipoA.length === 1 && equipoB.length === 1) {
      const pEloBase = expectedScore(jugadores[equipoA[0]], jugadores[equipoB[0]]);
      const pA = pEloBase; 
      const sA = ganoA ? 1 : 0, sB = ganoA ? 0 : 1;
      deltaA = K_FACTOR * movMulti * (sA - pA);
      deltaB = K_FACTOR * movMulti * (sB - (1 - pA));
    } else {
      const r = actualizarEloEquipo(
        equipoA.map((n) => jugadores[n]), m.ladoA ?? null,
        equipoB.map((n) => jugadores[n]), m.ladoB ?? null,
        ganoA, m.pa, m.pb
      );
      deltaA = r.deltaA; deltaB = r.deltaB;
    }
    equipoA.forEach((n) => { jugadores[n] = jugadores[n] + deltaA; });
    equipoB.forEach((n) => { jugadores[n] = jugadores[n] + deltaB; });

    const ratingsDespues = {};
    [...equipoA, ...equipoB].forEach((n) => { ratingsDespues[n] = jugadores[n]; });

    const aLabel = equipoA.join(" y ");
    const bLabel = equipoB.join(" y ");
    const ganador = ganoA ? aLabel : bLabel;

    if (equipoA.length === 1 && equipoB.length === 1) {
      const pendienteEfectivo = m.forzarPendiente ?? pendiente;
      const resultado = actualizarTitulo(gm, pendienteEfectivo, m.esGM, ganador);
      gm = resultado.gm; pendiente = resultado.pendiente;
    }

    historial.push({
      id: Date.now() + idx,
      fecha: new Date(2026, 6, 10, 12, idx * 10).toISOString(),
      hora: m.hora || null, ladoA: m.ladoA || null, ladoB: m.ladoB || null,
      solLado: m.solLado || null, viento: !!m.viento,
      teamA: equipoA, teamB: equipoB, aLabel, bLabel,
      pa: m.pa, pb: m.pb, esGM: !!m.esGM,
      ganador, ratingsAntes, ratingsDespues,
      apuestas: [],
    });
  });
  return { jugadores, gm, pendiente, margen: 0.08, bettors: {}, partidoAbierto: null, historial: historial.reverse(), vetados: [] };
}

function colorFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 62%, 44%)`;
}

function Avatar({ name, size = 28 }) {
  const iniciales = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold c-text-1 shrink-0 ring-2 ring-black/20 shadow-sm"
      style={{ background: colorFromName(name), width: size, height: size, fontSize: size * 0.4 }}
    >
      {iniciales}
    </span>
  );
}

function Chip({ children, tone = "gold" }) {
  const tones = {
    gold: "c-bg-gold-soft c-bd-gold-50 c-text-gold",
    live: "c-bg-red-soft c-bd-red-50 c-text-red",
    ok: "c-bg-green-soft c-bd-green-50 c-text-green",
    info: "c-bg-blue-soft c-bd-blue-50 c-text-blue",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap shadow-sm ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StatBar({ icon: Icon, title, w, l, barClass, textClass }) {
  const total = w + l;
  const pct = total === 0 ? 0 : Math.round((w / total) * 100);
  return (
      <div className="mb-2.5 last:mb-0">
          <div className="flex justify-between items-end mb-1">
              <div className={`flex items-center gap-1.5 text-xs font-semibold c-text-1`}>
                  {Icon && <Icon size={14} className={textClass} />}
                  {title}
              </div>
              <div className="text-[10px] font-bold c-text-2">
                  {total > 0 ? `${pct}%` : "S/D"} <span className="font-mono font-normal ml-1">({w}V-{l}D)</span>
              </div>
          </div>
          <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden shadow-inner flex">
              <div style={{ width: `${pct}%` }} className={`h-full ${barClass} transition-all duration-500`}></div>
          </div>
      </div>
  )
}

function BotonCuota({ etiqueta, valor, valorBase, boosteado, locked, onClick, disabled, sub, activo, isEditing }) {
  if (locked && !isEditing) {
    return (
      <button disabled className="relative flex-1 c-minw-84 rounded-lg px-2 py-2.5 text-center border-2 c-bg-app c-bd-1 opacity-50 cursor-not-allowed">
        <div className="absolute top-1 right-1"><Lock size={12} className="c-text-2" /></div>
        <div className="text-[10.5px] leading-tight font-semibold truncate c-text-2">{etiqueta}</div>
        {sub && <div className="text-[9px] c-text-2">{sub}</div>}
        <div className="font-extrabold text-base mt-0.5 c-text-2">BLOQ</div>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled && !isEditing}
      className={`relative flex-1 c-minw-84 rounded-lg px-2 py-2.5 text-center transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:active:scale-100 border-2 ${
        locked && isEditing 
          ? "c-bg-red-soft c-bd-red-50"
          : boosteado
          ? `boost-cuota border-transparent ${activo ? "ring-4 ring-white scale-110" : ""}`
          : activo
          ? "c-bg-orange c-bd-orange c-shadow-glow-orange scale-105"
          : "c-bg-app c-bd-1 hover:c-bd-orange-60"
      }`}
    >
      {locked && isEditing && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 c-bg-red text-white text-[8px] font-extrabold px-2 py-0.5 rounded-full shadow whitespace-nowrap">
          BLOQUEADA
        </span>
      )}
      {boosteado && !locked && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 c-bg-mesa text-white text-[8px] font-extrabold px-2 py-0.5 rounded-full shadow whitespace-nowrap">
          🔥 SUPERCUOTA
        </span>
      )}
      {activo && (
        <span className="absolute -bottom-2 -right-2 rounded-full p-1 shadow-md bg-white">
          <Check size={12} strokeWidth={4} className={boosteado ? "c-text-mesa" : "c-text-orange-lg"} />
        </span>
      )}
      <div className={`text-[10.5px] leading-tight font-semibold truncate ${boosteado && !locked ? "text-white" : activo ? "c-text-dark-on-accent" : "c-text-2"}`}>{etiqueta}</div>
      {sub && <div className={`text-[9px] ${boosteado && !locked ? "text-white/80" : activo ? "c-text-dark-on-accent-70" : "c-text-2"}`}>{sub}</div>}
      {boosteado && !locked && typeof valorBase === "number" && (
        <div className="text-[10px] line-through text-white/70 font-semibold -mb-0.5">{valorBase.toFixed(2)}</div>
      )}
      <div className="font-extrabold text-base mt-0.5" style={{ fontVariantNumeric: "tabular-nums", color: (boosteado && !locked) ? "#FFFFFF" : activo ? "#1A0D05" : "#C2410C" }}>
        {typeof valor === "number" ? valor.toFixed(2) : (locked ? "BLOQ" : "---")}
      </div>
    </button>
  );
}

function Panel({ icon: Icon, titulo, children, badge }) {
  return (
    <div className="relative rounded-xl border c-bd-2 c-grad-panel p-3 pt-4 space-y-2.5 c-shadow-card overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 c-bg-mesa" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 c-text-1">
          <Icon size={14} className="c-text-orange" />
          <h3 className="text-[12.5px] font-bold uppercase tracking-wide">{titulo}</h3>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function CondicionesBadges({ hora, ladoA, ladoB, solLado, viento, nombreA, nombreB }) {
  if (!hora && !ladoA && !solLado && !viento) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {hora && <Chip tone="info"><Clock size={10} /> {hora}</Chip>}
      {ladoA && <Chip tone="info">{nombreA} · {ladoA}</Chip>}
      {ladoB && <Chip tone="info">{nombreB} · {ladoB}</Chip>}
      {solLado && <Chip tone="gold"><Sun size={10} /> sol en {solLado}</Chip>}
      {viento && <Chip tone="live"><Wind size={10} /> viento</Chip>}
    </div>
  );
}

function TicketApuesta({ bettor, apuestas, onCerrar }) {
  const total = apuestas.reduce((s, a) => s + a.stake, 0);
  const premio = apuestas.reduce((s, a) => s + a.stake * a.cuota, 0);
  const esCombinada = apuestas.length === 1 && apuestas[0].tipo === "combinada";
  const patasVisibles = esCombinada ? apuestas[0].patas : apuestas;
  const hayBoost = patasVisibles.some((p) => p.boosteada);
  return (
    <div className="relative mx-auto max-w-xs c-anim-stampin">
      <div className={`c-bg-white border-2 border-dashed rounded-md p-4 shadow-2xl ${hayBoost ? "c-bd-mesa" : "c-bd-orange-60"}`} style={{ fontFamily: "'Space Mono', monospace" }}>
        {hayBoost && <div className="text-center text-[10px] font-extrabold c-text-mesa mb-1">🔥 INCLUYE SUPERCUOTA 🔥</div>}
        <div className="text-center border-b border-dashed c-bd-1 pb-2 mb-2">
          <div className="text-[10px] c-tracking-wide2 c-text-2">PINO-PONG · RESGUARDO</div>
          <div className="text-sm font-bold c-text-orange mt-1">
            {esCombinada ? `COMBINADA (${apuestas[0].patas.length} PATAS)` : apuestas.length > 1 ? `${apuestas.length} APUESTAS CONFIRMADAS` : "APUESTA CONFIRMADA"}
          </div>
          <div className="text-[11px] c-text-1 font-bold mt-0.5">{bettor}</div>
        </div>
        <div className="text-[11px] space-y-1.5 c-text-3 max-h-40 overflow-y-auto pr-1">
          {esCombinada ? (
            apuestas[0].patas.map((p, i) => (
              <div key={i} className={`flex justify-between border-b border-dashed c-bd-1-60 pb-1 ${p.boosteada ? "c-text-mesa font-bold" : ""}`}>
                <span className="truncate pr-2">{p.boosteada && "🔥 "}{p.mercado} · <b className="c-text-1">{p.seleccion}</b></span>
                <span className="shrink-0 c-text-orange font-bold">{p.cuota.toFixed(2)}</span>
              </div>
            ))
          ) : (
            apuestas.map((ap) => (
              <div key={ap.id} className={`flex justify-between border-b border-dashed c-bd-1-60 pb-1 ${ap.boosteada ? "c-text-mesa font-bold" : ""}`}>
                <span className="truncate pr-2">{ap.boosteada && "🔥 "}{ap.mercado} · <b className="c-text-1">{ap.seleccion}</b></span>
                <span className="shrink-0 c-text-orange font-bold">{ap.stake.toFixed(2)}×{ap.cuota.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
        <div className="text-[12px] space-y-1 c-text-3 pt-2">
          <div className="flex justify-between"><span>Total apostado</span><span className="font-bold c-text-1">{total.toFixed(2)} fichas</span></div>
          <div className="flex justify-between font-bold border-t border-dashed c-bd-1 pt-1 mt-1">
            <span>Premio máximo</span><span className="c-text-green">{premio.toFixed(2)} fichas</span>
          </div>
        </div>
      </div>
      <button onClick={onCerrar} className="mt-2 w-full text-center text-xs c-text-2 font-semibold underline">Cerrar</button>
    </div>
  );
}

function ModalDetalleApuesta({ apuesta, onCerrar }) {
  if (!apuesta) return null;
  const esComb = apuesta.tipo === "combinada";
  const patas = esComb ? apuesta.patas : [apuesta];
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-sm border c-bd-1 c-maxh-80vh overflow-y-auto relative">
         <button onClick={onCerrar} className="absolute top-4 right-4 c-text-2"><X size={18} /></button>
         <h3 className="font-bold c-text-1 flex items-center gap-2 mb-3 pr-6">
            <Avatar name={apuesta.bettor} size={20} />
            {esComb ? `Combinada de ${apuesta.bettor}` : `Apuesta de ${apuesta.bettor}`}
         </h3>
         
         <div className="text-sm c-text-3 mb-2 font-medium">
            Para ganar esta apuesta, {esComb ? "tienen que darse TODOS estos resultados:" : "tiene que darse este resultado:"}
         </div>
         
         <div className="space-y-2 mb-4">
            {patas.map((p, i) => (
                <div key={i} className={`p-2.5 rounded-lg border ${p.acertada === true ? 'c-bg-green-soft c-bd-green-50' : p.acertada === false ? 'c-bg-red-soft c-bd-red-50' : 'c-bg-app c-bd-1'}`}>
                   <div className="font-bold text-sm c-text-1 mb-1">{p.mercado} · {p.seleccion}</div>
                   {p.acertada !== undefined && (
                       <div className={`text-xs font-bold mt-2 pt-2 border-t border-dashed ${p.acertada ? 'c-text-green c-bd-green-50' : 'c-text-red2 c-bd-red-50'}`}>
                          {p.acertada ? "✅ ACERTADA" : "❌ FALLADA"}
                       </div>
                   )}
                </div>
            ))}
         </div>
         
         <div className="flex justify-between items-center text-sm border-t c-bd-1 pt-3">
             <div><span className="c-text-2">Apostado:</span> <span className="font-bold">{apuesta.stake.toFixed(2)}</span></div>
             <div><span className="c-text-2">Cuota:</span> <span className="font-bold">{apuesta.cuota.toFixed(2)}</span></div>
             <div><span className="c-text-2">Premio:</span> <span className="font-bold c-text-green">{(apuesta.stake * apuesta.cuota).toFixed(2)}</span></div>
         </div>
      </div>
    </div>
  )
}

function Confeti({ nombre, onFin, tipo = "gm" }) {
  useEffect(() => { const t = setTimeout(onFin, 2400); return () => clearTimeout(t); }, [onFin]);
  const emojis = tipo === "supercuota" ? ["🔥", "💰", "⚡", "✨"] : ["🎉", "🏓", "👑", "🥳"];
  const piezas = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.6 + Math.random() * 1,
    emoji: emojis[i % 4],
  })), [tipo]);
  return (
    <div className="fixed inset-0 c-z60 pointer-events-none overflow-hidden">
      {piezas.map((p) => (
        <span key={p.id} className="absolute text-2xl" style={{ left: `${p.left}%`, top: "-40px", animation: `caer ${p.dur}s ease-in ${p.delay}s forwards` }}>{p.emoji}</span>
      ))}
      <div className="absolute top-16 inset-x-0 flex justify-center px-4">
        <div className={`c-bg-white-95 border rounded-xl px-4 py-2.5 text-center shadow-2xl c-anim-fadein-3 ${tipo === "supercuota" ? "boost-cuota" : "c-bd-gold-50"}`}>
          {tipo === "supercuota" ? (
            <>
              <div className="text-white font-extrabold text-sm flex items-center gap-1.5 justify-center">🔥 ¡SUPERCUOTA CONFIRMADA!</div>
              <div className="text-white font-bold text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{nombre}</div>
            </>
          ) : (
            <>
              <div className="c-text-gold font-bold text-sm flex items-center gap-1.5 justify-center"><Crown size={16} /> ¡Nuevo Gran Maestro!</div>
              <div className="c-text-1 font-bold text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{nombre}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalConfirmar({ titulo, mensaje, onCancelar, onConfirmar, textoConfirmar = "Confirmar", peligro }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancelar}>
      <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1">
        <div className="font-bold c-text-1">{titulo}</div>
        <div className="text-sm c-text-2">{mensaje}</div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancelar} className="flex-1 rounded-lg border c-bd-1 c-text-2 py-2 text-sm font-semibold">Cancelar</button>
          <button onClick={onConfirmar} className={`flex-1 rounded-lg py-2 text-sm font-bold ${peligro ? "c-bg-red text-white" : "c-bg-orange c-text-1"}`}>{textoConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

function ModalPerfil({ nombre, perfil, rating, statsAvanzadas, onCerrar }) {
  const rivales = Object.entries(perfil.h2h).sort((a, b) => b[1].n - a[1].n);
  const [h2hExpandido, setH2hExpandido] = useState(null);

  const st = statsAvanzadas || { cV:0, cD:0, kV:0, kD:0, solV:0, solD:0, solRivalV:0, solRivalD:0, vientoV:0, vientoD:0, upsetV:0, upsetD:0, favV:0, favD:0 };
  const partidosJugados = st.cV + st.cD + st.kV + st.kD;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full max-w-md border c-bd-1 c-maxh-80vh overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar name={nombre} size={40} />
            <div>
              <div className="font-bold c-text-1 text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}>{nombre.toUpperCase()}</div>
              <div className="flex gap-2 text-xs">
                <span className="font-bold c-text-orange bg-orange-100 px-1.5 rounded">ELO {rating.toFixed(0)}</span>
                <span className="c-text-2 font-medium bg-gray-100 px-1.5 rounded">{partidosJugados} jugados</span>
              </div>
            </div>
          </div>
          <button onClick={onCerrar} className="c-text-2 bg-gray-100 p-1.5 rounded-full hover:bg-gray-200"><X size={20} /></button>
        </div>

        {Math.abs(perfil.racha) >= 2 && (
          <div className="mb-4">
             <Chip tone={perfil.racha > 0 ? "gold" : "info"}>
               {perfil.racha > 0 ? "🔥" : "❄️"} {Math.abs(perfil.racha)} {perfil.racha > 0 ? "victorias" : "derrotas"} seguidas
             </Chip>
          </div>
        )}

        {partidosJugados > 0 && (
           <div className="space-y-4 p-3.5 c-bg-app rounded-xl border c-bd-2 shadow-inner mb-4">
              <h4 className="text-xs uppercase font-bold c-text-2 mb-1">📊 Situación y Condiciones</h4>
              
              <div className="space-y-2.5 bg-white p-3 rounded-lg shadow-sm border c-bd-1" style={{borderLeftWidth: '4px', borderLeftColor: '#3B82F6'}}>
                 <div className="text-[10px] font-bold c-text-4 uppercase mb-1 flex items-center gap-1"><MapPin size={12} /> Terreno de juego</div>
                 <StatBar title="Lado Canasta" w={st.cV} l={st.cD} barClass="c-bg-blue" textClass="c-text-blue" icon={MapPin} />
                 <StatBar title="Lado Columpios" w={st.kV} l={st.kD} barClass="c-bg-orange" textClass="c-text-orange" icon={MapPin} />
              </div>

              <div className="space-y-2.5 bg-white p-3 rounded-lg shadow-sm border c-bd-1" style={{borderLeftWidth: '4px', borderLeftColor: '#EAB308'}}>
                 <div className="text-[10px] font-bold c-text-4 uppercase mb-1 flex items-center gap-1"><Sun size={12} /> Resistencia al Clima</div>
                 <StatBar icon={Sun} title="Con sol molestándole" w={st.solV} l={st.solD} barClass="c-bg-gold" textClass="c-text-gold" />
                 <StatBar icon={Sun} title="Con sol molestando al rival" w={st.solRivalV} l={st.solRivalD} barClass="c-bg-orange" textClass="c-text-orange" />
                 <StatBar icon={Wind} title="En partidos con viento" w={st.vientoV} l={st.vientoD} barClass="c-bg-teal" textClass="c-text-teal" />
              </div>

              <div className="space-y-2.5 bg-white p-3 rounded-lg shadow-sm border c-bd-1" style={{borderLeftWidth: '4px', borderLeftColor: '#22C55E'}}>
                 <div className="text-[10px] font-bold c-text-4 uppercase mb-1 flex items-center gap-1"><Trophy size={12} /> Nivel ELO de partida</div>
                 <StatBar icon={TrendingUp} title="Dando la sorpresa (vs ELO Superior)" w={st.upsetV} l={st.upsetD} barClass="c-bg-green" textClass="c-text-green" />
                 <StatBar icon={TrendingDown} title="Como favorito (vs ELO Inferior)" w={st.favV} l={st.favD} barClass="c-bg-red" textClass="c-text-red" />
              </div>
           </div>
        )}

        <div className="bg-white p-3.5 rounded-xl border c-bd-2 shadow-sm mb-4">
          <h4 className="text-xs uppercase font-bold c-text-2 mb-3">⚔️ Cara a Cara (H2H)</h4>
          {rivales.length === 0 ? (
            <p className="text-sm c-text-2 text-center py-2 bg-gray-50 rounded-lg">No hay registros contra otros jugadores aún.</p>
          ) : (
            <div className="space-y-2">
              {rivales.map(([rival, d]) => (
                <div key={rival} className="border c-bd-2 rounded-lg bg-gray-50 overflow-hidden shadow-sm">
                   <div
                     className="flex justify-between items-center text-sm px-3 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors"
                     onClick={() => setH2hExpandido(h2hExpandido === rival ? null : rival)}
                   >
                     <span className="c-text-1 font-bold flex items-center gap-2">vs {rival}</span>
                     <div className="flex items-center gap-3">
                         <span className="font-mono font-extrabold text-base c-text-mesa">{d.victorias} <span className="c-text-3 font-medium text-xs">V</span> - {d.n - d.victorias} <span className="c-text-3 font-medium text-xs">D</span></span>
                         {h2hExpandido === rival ? <ChevronUp size={16} className="c-text-4" /> : <ChevronDown size={16} className="c-text-4" />}
                     </div>
                   </div>
                   {h2hExpandido === rival && (
                      <div className="px-3 pb-3 space-y-1 bg-white border-t c-bd-2 pt-2">
                         {d.partidos.length === 0 ? <span className="text-xs c-text-3">Sin registro detallado</span> : null}
                         {d.partidos.map(p => (
                            <div key={p.id} className="text-[11px] flex justify-between c-text-3 border-b c-bd-1-60 last:border-0 py-1.5">
                               <span>{new Date(p.fecha).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · {p.aLabel} <span className={p.pa > p.pb ? "font-bold text-black" : ""}>{p.pa}</span>-<span className={p.pb > p.pa ? "font-bold text-black" : ""}>{p.pb}</span> {p.bLabel}</span>
                               <span className={`px-1.5 rounded font-bold ${p.ganador === nombre ? "bg-green-100 c-text-green" : "bg-red-100 c-text-red2"}`}>{p.ganador === nombre ? "W" : "L"}</span>
                            </div>
                         ))}
                      </div>
                   )}
                </div>
              ))}
            </div>
          )}
        </div>

        {perfil.ultimos.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-gray-50 p-3 border c-bd-2">
            <div className="text-[10px] font-bold uppercase tracking-wide c-text-2 mb-2">Últimos {perfil.ultimos.length} partidos jugados</div>
            {perfil.ultimos.map((p) => (
              <div key={p.id} className="text-xs flex justify-between items-center c-text-2 border-b c-bd-1-60 last:border-0 pb-1.5 mb-1.5 last:pb-0 last:mb-0">
                <span>{p.aLabel} <span className="font-mono">{p.pa} – {p.pb}</span> {p.bLabel}</span>
                <span className={p.ganador === nombre ? "c-text-green font-bold" : "c-text-red2 font-bold"}>{p.ganador === nombre ? "Ganó" : "Perdió"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Lock = ({ size, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
);

export default function CasaApuestasPingpong() {
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState("partido");
  const [nuevoJugador, setNuevoJugador] = useState("");
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [esGM, setEsGM] = useState(false);
  const [horaInput, setHoraInput] = useState(() => new Date().toTimeString().slice(0, 5));
  const [ladoAInput, setLadoAInput] = useState("Canasta");
  const [solLadoInput, setSolLadoInput] = useState(null);
  const [vientoInput, setVientoInput] = useState(false);
  const [slip, setSlip] = useState([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const [slipError, setSlipError] = useState("");
  const [bettorSlip, setBettorSlip] = useState("");
  const [modoSlip, setModoSlip] = useState("simples");
  const [stakeCombinada, setStakeCombinada] = useState("50");
  const [handicapK, setHandicapK] = useState(5);
  const [lineaA, setLineaA] = useState(12);
  const [lineaB, setLineaB] = useState(12);
  const [ticketVisible, setTicketVisible] = useState(null);
  
  const [ptsCreatorA, setPtsCreatorA] = useState("");
  const [ptsCreatorB, setPtsCreatorB] = useState("");
  const [detalleApuestaVisible, setDetalleApuestaVisible] = useState(null);

  const [marcador, setMarcador] = useState({ a: "", b: "" });
  const [error, setError] = useState("");
  const [celebracion, setCelebracion] = useState(null);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [modoEspectador, setModoEspectador] = useState(true);
  const [pidiendoPassword, setPidiendoPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [csvVisible, setCsvVisible] = useState(null);
  const [csvCopiado, setCsvCopiado] = useState(false);
  const [fabPop, setFabPop] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(null);
  const [modoEditarCuotas, setModoEditarCuotas] = useState(false);
  const [editarCuotaObjetivo, setEditarCuotaObjetivo] = useState(null);
  const [editarCuotaInput, setEditarCuotaInput] = useState("");
  
  const [modalNuevoMercado, setModalNuevoMercado] = useState(false);
  const [nombreMercadoCustom, setNombreMercadoCustom] = useState("");
  const [seleccionMercadoCustom, setSeleccionMercadoCustom] = useState("");
  const [cuotaMercadoCustom, setCuotaMercadoCustom] = useState("");

  const [resolviendoCustoms, setResolviendoCustoms] = useState(null);

  const [accionProtegida, setAccionProtegida] = useState(null);
  const [pwdProtegida, setPwdProtegida] = useState("");
  const [errProtegida, setErrProtegida] = useState("");
  const [modalDonar, setModalDonar] = useState(null);
  const [cantidadDonar, setCantidadDonar] = useState("");

  const prevSlipLen = useRef(0);
  const ultimoSincronizado = useRef(null);

  useEffect(() => {
    const unsubscribe = suscribirEstado((remoto) => {
      const estadoMerged = remoto ? { ...ESTADO_DEFECTO, ...remoto } : ESTADO_DEFECTO;
      // Firebase borra los campos vacíos ({} o []) en CUALQUIER nivel al guardar,
      // así que un partido recién abierto (apuestas/mercadosCustom vacíos) puede
      // volver sin esos campos. Los rellenamos para que nada intente iterarlos.
      if (estadoMerged.partidoAbierto) {
        estadoMerged.partidoAbierto = {
          apuestas: [],
          mercadosCustom: [],
          boosts: {},
          ...estadoMerged.partidoAbierto,
        };
      }
      // Siempre aplicamos lo que llega de Firebase (es la fuente de verdad).
      // Guardamos su "huella" para que el efecto de guardado de abajo no
      // vuelva a reenviarlo si no ha cambiado nada realmente.
      ultimoSincronizado.current = JSON.stringify(estadoMerged);
      setEstado(estadoMerged);
      setCargando(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!estado?.partidoAbierto) return;
    const partidoActual = estado.partidoAbierto;
    
    const ctxPartido = { 
      ladoA: partidoActual.ladoA, 
      ladoB: partidoActual.ladoB, 
      solLado: partidoActual.solLado, 
      viento: partidoActual.viento, 
      esGM: partidoActual.esGM 
    };

    const pA_punto = calcularProbabilidadPuntoPura(estado.historial || [], partidoActual.a, partidoActual.b, ctxPartido);
    const mercadosTemp = calcularMercadosDesdeProbabilidad(pA_punto, estado.margen, partidoActual.a, partidoActual.b);
    
    const stakeA = sumaStakeGanador(partidoActual.apuestas, partidoActual.a);
    const stakeB = sumaStakeGanador(partidoActual.apuestas, partidoActual.b);
    const ganDineroTemp = cuotaGanadorConDinero(mercadosTemp.ganador.pA, estado.margen, stakeA, stakeB);

    setSlip(prevSlip => prevSlip.map(s => {
      let nuevaCuota = s.cuota;
      let boostEncontrado = boostDe(partidoActual, s.mercado, s.seleccion);
      
      if (boostEncontrado === "LOCKED") return s; 
      
      if (boostEncontrado) {
        nuevaCuota = boostEncontrado;
      } else if (s.mercado === "Ganador") {
        if (s.seleccion === partidoActual.a) nuevaCuota = ganDineroTemp.A;
        if (s.seleccion === partidoActual.b) nuevaCuota = ganDineroTemp.B;
      } else if (s.mercado === "Resultado Exacto Partido") {
        const itemRes = mercadosTemp.resultadosExactos.find(r => r.marcador === s.seleccion);
        if (itemRes) nuevaCuota = itemRes.cuota;
      } else if (s.mercado.startsWith("Puntos Exactos")) {
        const pts = Number(s.seleccion);
        const jugA = s.mercado.replace("Puntos Exactos ", "") === partidoActual.a;
        nuevaCuota = cuota(probPuntosIndividual(mercadosTemp.terminales, pts, jugA), estado.margen);
      } else if (s.mercado === "Cómo termina") {
        if (s.seleccion === "parciales") nuevaCuota = mercadosTemp.comoTermina.parciales;
        if (s.seleccion === "normal") nuevaCuota = mercadosTemp.comoTermina.normal;
        if (s.seleccion === "ajustado") nuevaCuota = mercadosTemp.comoTermina.ajustado;
      }
      return { ...s, cuota: Number(nuevaCuota.toFixed(2)) };
    }));
  }, [estado?.partidoAbierto?.boosts, estado?.margen, estado?.historial]);

  useEffect(() => {
    if (slip.length > prevSlipLen.current) {
      setFabPop(true);
      const t = setTimeout(() => setFabPop(false), 260);
      prevSlipLen.current = slip.length;
      return () => clearTimeout(t);
    }
    prevSlipLen.current = slip.length;
  }, [slip.length]);

  const persistir = useCallback((updater) => {
    setEstado(updater);
  }, []);

  useEffect(() => {
    if (estado && !cargando) {
      const str = JSON.stringify(estado);
      if (str === ultimoSincronizado.current) return; // ya está igual en Firebase, no reenviar
      ultimoSincronizado.current = str;
      guardarEstado(estado);
    }
  }, [estado, cargando]);

  if (cargando || !estado) {
    return (
      <div className="min-h-screen flex items-center justify-center c-bg-app">
        <Loader2 className="animate-spin c-text-orange-lg" size={28} />
      </div>
    );
  }

  const nombresJugadores = Object.keys(estado.jugadores);
  const partido = estado.partidoAbierto;
  const ratingDe = (n) => estado.jugadores[n] ?? RATING_INICIAL;
  const ladoBAuto = ladoAInput === "Canasta" ? "Columpios" : "Canasta";

  function agregarJugador() {
    const nombre = nuevoJugador.trim();
    if (!nombre) return;
    if (estado.jugadores[nombre] !== undefined) { setNuevoJugador(""); return; }
    persistir({ ...estado, jugadores: { ...estado.jugadores, [nombre]: RATING_INICIAL }, bettors: { ...estado.bettors, [nombre]: 500 } });
    setNuevoJugador("");
  }

  function fijarGMInicial(nombre) {
    persistir({ ...estado, gm: nombre });
  }

  const PASSWORD_BOSS = "123457";

  function pedirModoBoss() {
    setPasswordInput("");
    setError("");
    setPidiendoPassword(true);
  }

  function confirmarPassword() {
    if (passwordInput === PASSWORD_BOSS) {
      setModoEspectador(false);
      setPidiendoPassword(false);
      setPasswordInput("");
      setError("");
    } else {
      setError("Contraseña incorrecta.");
    }
  }

  function pasarAEspectador() {
    setModoEspectador(true);
    setModoEditarCuotas(false);
  }

  function solicitarAccionProtegida(tipo, payload) {
    setAccionProtegida({ tipo, payload });
    setPwdProtegida("");
    setErrProtegida("");
  }

  function ejecutarAccionProtegida() {
    if (pwdProtegida !== PASSWORD_BOSS) {
      setErrProtegida("Contraseña incorrecta.");
      return;
    }
    if (accionProtegida.tipo === 'anular_apuesta') {
      realizarAnulacionApuesta(accionProtegida.payload);
    } else if (accionProtegida.tipo === 'eliminar_apostante') {
      realizarEliminacionApostante(accionProtegida.payload);
    }
    setAccionProtegida(null);
  }

  function realizarAnulacionApuesta(idApuesta) {
    persistir(prev => {
      if (!prev.partidoAbierto) return prev;
      
      const ap = prev.partidoAbierto.apuestas.find(a => a.id === idApuesta);
      if (!ap) return prev;
      
      const nuevosBettors = { ...prev.bettors };
      if (ap.estado === "pendiente") {
        nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] || 0) + ap.stake).toFixed(2));
      }
      
      const nuevoPartido = { 
        ...prev.partidoAbierto, 
        apuestas: prev.partidoAbierto.apuestas.filter(a => a.id !== idApuesta) 
      };
      
      return { ...prev, bettors: nuevosBettors, partidoAbierto: nuevoPartido };
    });
  }

  function realizarEliminacionApostante(nombre) {
    persistir(prev => {
      const nuevosBettors = { ...prev.bettors };
      delete nuevosBettors[nombre];

      const nuevosVetados = (prev.vetados || []).filter(n => n !== nombre);
      
      return {
        ...prev,
        bettors: nuevosBettors,
        vetados: nuevosVetados
      };
    });
  }

  function procesarDonacion() {
    const qty = Number(cantidadDonar.replace(',', '.'));
    if (isNaN(qty)) return;
    
    persistir(prev => {
      const nuevosBettors = { ...prev.bettors };
      nuevosBettors[modalDonar] = Number(((nuevosBettors[modalDonar] || 0) + qty).toFixed(2));
      return { ...prev, bettors: nuevosBettors };
    });
    setModalDonar(null);
    setCantidadDonar("");
  }

  function exportarHistorial() {
    const csv = historialACSV(estado.historial || []);
    try { descargarCSV(csv, "pinamax_historial.csv"); } catch (e) {}
    setCsvCopiado(false);
    setCsvVisible(csv);
  }

  async function copiarCSV() {
    try {
      await navigator.clipboard.writeText(csvVisible);
      setCsvCopiado(true);
    } catch (e) {
      setError("No se pudo copiar automáticamente.");
    }
  }

  function crearPartido() {
    setError("");
    if (!selA || !selB || selA === selB) { setError("Elige dos jugadores distintos."); return; }
    const auto = (selA === estado.gm || selB === estado.gm);
    const nuevo = {
      id: Date.now(), a: selA, b: selB, esGM: esGM && auto, apuestas: [],
      hora: horaInput, ladoA: ladoAInput, ladoB: ladoBAuto, solLado: solLadoInput, viento: vientoInput,
      mercadosCustom: []
    };
    persistir({ ...estado, partidoAbierto: nuevo });
    
    // Reset inputs
    setSelA(""); setSelB(""); setEsGM(false); setSolLadoInput(null); setVientoInput(false);
  }

  function cancelarPartido() {
    if (partido && partido.apuestas && partido.apuestas.length > 0) {
      let nuevosBettors = { ...estado.bettors };
      partido.apuestas.forEach(ap => {
        if (ap.estado === "pendiente") {
          nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] || 500) + ap.stake).toFixed(2));
        }
      });
      setSlip([]);
      persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: null });
      return;
    }
    setSlip([]);
    persistir({ ...estado, partidoAbierto: null });
  }

  function abrirEditorCuota(mercado, seleccion, valorBase, etiqueta) {
    const actual = boostDe(partido, mercado, seleccion);
    setEditarCuotaObjetivo({ mercado, seleccion, valorBase, etiqueta, isLocked: actual === "LOCKED" });
    setEditarCuotaInput(actual === "LOCKED" ? "" : (actual ? String(actual) : ""));
    setError("");
  }

  function guardarCuotaEditada() {
    const { mercado, seleccion } = editarCuotaObjetivo;
    const valorLimpio = editarCuotaInput.trim().replace(',', '.');
    const val = valorLimpio ? Number(valorLimpio) : null;

    if (valorLimpio && (!val || val < 1.05)) {
      setError("La cuota debe ser 1.05 o más.");
      return;
    }
    
    persistir(prev => {
      if (!prev.partidoAbierto) return prev;
      const nuevosBoosts = { ...(prev.partidoAbierto.boosts || {}) };
      const clave = claveBoost(mercado, seleccion);

      if (val) nuevosBoosts[clave] = Number(val.toFixed(2));
      else delete nuevosBoosts[clave];

      return { ...prev, partidoAbierto: { ...prev.partidoAbierto, boosts: nuevosBoosts } };
    });
    
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
    setError("");
  }

  function bloquearCuota() {
    const { mercado, seleccion } = editarCuotaObjetivo;
    persistir(prev => {
      if (!prev.partidoAbierto) return prev;
      const nuevosBoosts = { ...(prev.partidoAbierto.boosts || {}) };
      nuevosBoosts[claveBoost(mercado, seleccion)] = "LOCKED";
      return { ...prev, partidoAbierto: { ...prev.partidoAbierto, boosts: nuevosBoosts } };
    });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
  }

  function quitarCuotaEditada() {
    if (!editarCuotaObjetivo) return;
    persistir(prev => {
      if (!prev.partidoAbierto) return prev;
      const nuevosBoosts = { ...(prev.partidoAbierto.boosts || {}) };
      delete nuevosBoosts[claveBoost(editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion)];
      return { ...prev, partidoAbierto: { ...prev.partidoAbierto, boosts: nuevosBoosts } };
    });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
  }

  function manejarClicCuota(mercado, seleccion, valorBase, etiqueta) {
    if (modoEditarCuotas && !modoEspectador) {
      abrirEditorCuota(mercado, seleccion, valorBase, etiqueta);
      return;
    }
    const status = boostDe(partido, mercado, seleccion);
    if (status === "LOCKED") return;
    const valorFinal = status ?? valorBase;
    toggleSlip(mercado, seleccion, Number(valorFinal.toFixed(2)));
  }

  function estaEnSlip(mercado, seleccion) {
    return slip.find((s) => s.mercado === mercado && s.seleccion === seleccion);
  }

  function toggleSlip(mercado, seleccion, cuota) {
    const existente = estaEnSlip(mercado, seleccion);
    if (existente) { setSlip(slip.filter((s) => s.id !== existente.id)); return; }
    
    const nuevaSel = { mercado, seleccion };
    const conflicto = slip.find((s) => sonContradictorias(s, nuevaSel, partido));
    
    if (conflicto) {
      setSlipError(`Lógicamente imposible: "${seleccion}" choca con "${conflicto.seleccion}".`);
      setSlipOpen(true);
      return;
    }

    setError("");
    setSlipError("");
    setSlip([...slip, { id: Date.now() + Math.random(), mercado, seleccion, cuota: Number(cuota.toFixed(2)), stake: 50 }]);
  }

  function actualizarStakeSlip(id, valor) {
    const valorLimpio = valor.replace(',', '.');
    setSlip(slip.map((s) => (s.id === id ? { ...s, stake: Number(valorLimpio) || 0 } : s)));
  }
  function quitarDeSlip(id) {
    setSlip(slip.filter((s) => s.id !== id));
  }

  function confirmarSlip() {
    setSlipError("");
    const nombre = bettorSlip.trim();
    if (!nombre) { setSlipError("Escribe el nombre de quién hace la apuesta."); return; }
    if (estado.vetados?.includes(nombre)) { setSlipError(`${nombre} está vetado por la casa y no puede apostar.`); return; }
    
    const hasLocked = slip.some(s => boostDe(partido, s.mercado, s.seleccion) === "LOCKED");
    if (hasLocked) { setSlipError("Una de las cuotas de tu cesta acaba de ser bloqueada por la casa. Quítala para continuar."); return; }

    const saldoActual = estado.bettors[nombre] ?? 500;
    const rachaApostante = calcularRachaApuestas(estado.historial || [], nombre);
    const bonus = bonusPorRachaApostante(rachaApostante);

    if (modoSlip === "combinada" && slip.length >= 2) {
      const stakeVal = Number(stakeCombinada.replace(',', '.')) || 0;
      if (stakeVal <= 0) { setSlipError("Pon una cantidad de fichas válida."); return; }
      if (saldoActual < stakeVal) { setSlipError(`${nombre} solo tiene ${saldoActual.toFixed(2)} fichas.`); return; }
      
      const cuotaSGP = calcularCuotaSGP(slip, mercados, partido, estado.margen);
      const cuotaTotal = Number((cuotaSGP * bonus).toFixed(2));
      
      const apuesta = {
        id: Date.now(), bettor: nombre, tipo: "combinada",
        patas: slip.map((s) => ({ mercado: s.mercado, seleccion: s.seleccion, cuota: Number(s.cuota.toFixed(2)), boosteada: typeof boostDe(partido, s.mercado, s.seleccion) === "number" && boostDe(partido, s.mercado, s.seleccion) > s.cuota })),
        cuota: cuotaTotal, stake: stakeVal, estado: "pendiente", bonusRacha: bonus > 1 ? bonus : null,
      };
      const nuevosBettors = { ...estado.bettors, [nombre]: Number((saldoActual - stakeVal).toFixed(2)) };
      const nuevoPartido = { ...partido, apuestas: [...partido.apuestas, apuesta] };
      persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido });
      setTicketVisible({ bettor: nombre, apuestas: [apuesta] });
      setSlip([]); setSlipOpen(false); setBettorSlip(""); setStakeCombinada("50");
      return;
    }

    const totalStake = slip.reduce((s, x) => s + x.stake, 0);
    if (slip.some((s) => !s.stake || s.stake <= 0)) { setSlipError("Todas las apuestas necesitan una cantidad de fichas."); return; }
    if (saldoActual < totalStake) { setSlipError(`${nombre} solo tiene ${saldoActual.toFixed(2)} fichas y esta cesta suma ${totalStake.toFixed(2)}.`); return; }
    
    const nuevasApuestas = slip.map((s) => {
      const cuotaFinalCalc = Number((s.cuota * bonus).toFixed(2));
      const bOriginal = boostDe(partido, s.mercado, s.seleccion);
      const esBoostReal = typeof bOriginal === "number" && bOriginal > s.cuota;
      return { 
        id: s.id, bettor: nombre, mercado: s.mercado, seleccion: s.seleccion, 
        cuota: cuotaFinalCalc, stake: Number(s.stake.toFixed(2)), estado: "pendiente", 
        bonusRacha: bonus > 1 ? bonus : null, boosteada: esBoostReal 
      };
    });
    const nuevosBettors = { ...estado.bettors, [nombre]: Number((saldoActual - totalStake).toFixed(2)) };
    const nuevoPartido = { ...partido, apuestas: [...partido.apuestas, ...nuevasApuestas] };
    persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido });
    setTicketVisible({ bettor: nombre, apuestas: nuevasApuestas });
    if (nuevasApuestas.some(ap => ap.boosteada)) setCelebracion({ nombre, tipo: "supercuota" });
    setSlip([]); setSlipOpen(false); setBettorSlip("");
  }

  function crearMercadoCustom() {
    const mNombre = nombreMercadoCustom.trim();
    const mSel = seleccionMercadoCustom.trim();
    const mCuotaVal = Number(cuotaMercadoCustom.trim().replace(',', '.'));

    if (!mNombre || !mSel || isNaN(mCuotaVal) || mCuotaVal < 1.05) {
      setError("Rellena todos los campos con valores válidos (cuota debe ser 1.05 o más).");
      return;
    }

    setError("");
    const listaActual = partido.mercadosCustom || [];
    const nuevoCustom = { id: Date.now(), mercado: mNombre, seleccion: mSel, cuota: Number(mCuotaVal.toFixed(2)) };
    const partidoActualizado = { ...partido, mercadosCustom: [...listaActual, nuevoCustom] };
    persistir({ ...estado, partidoAbierto: partidoActualizado });
    setNombreMercadoCustom("");
    setSeleccionMercadoCustom("");
    setCuotaMercadoCustom("");
    setModalNuevoMercado(false);
  }

  function eliminarMercadoCustom(idCustom) {
    persistir(prev => {
      if (!prev.partidoAbierto) return prev;
      const listaActual = prev.partidoAbierto.mercadosCustom || [];
      return { 
        ...prev, 
        partidoAbierto: { 
          ...prev.partidoAbierto, 
          mercadosCustom: listaActual.filter(item => item.id !== idCustom) 
        } 
      };
    });
  }

  function toggleVeto(nombre) {
    persistir(prev => {
      const vetados = prev.vetados || [];
      if (vetados.includes(nombre)) {
        return { ...prev, vetados: vetados.filter(n => n !== nombre) };
      } else {
        return { ...prev, vetados: [...vetados, nombre] };
      }
    });
  }

  function iniciarCierrePartido() {
    const pa = Number(marcador.a), pb = Number(marcador.b);
    if (isNaN(pa) || isNaN(pb) || pa === pb) { setError("Introduce un marcador válido."); return; }
    if (!isValidScore(pa, pb)) { setError("Ese marcador no es un resultado válido para acabar un partido (tiene que llegar a 21 ganando de 2, o ser un parcial válido como 7-0)."); return; }
    setError("");

    if (partido.mercadosCustom && partido.mercadosCustom.length > 0) {
      const respuestasDefecto = {};
      partido.mercadosCustom.forEach(c => { respuestasDefecto[`${c.mercado}||${c.seleccion}`] = false; });
      setResolviendoCustoms({ respuestas: respuestasDefecto });
      return;
    }
    procesarCierrePartido({});
  }

  function procesarCierrePartido(customResults) {
    const pa = Number(marcador.a), pb = Number(marcador.b);
    const ratingA0 = ratingDe(partido.a), ratingB0 = ratingDe(partido.b);
    const ganoA = pa > pb;
    const ganador = ganoA ? partido.a : partido.b;
    const perdedor = ganoA ? partido.b : partido.a;
    
    const { gm, pendiente } = actualizarTitulo(estado.gm, estado.pendiente, partido.esGM, ganador);

    const resElo = actualizarEloEquipo([ratingA0], partido.ladoA, [ratingB0], partido.ladoB, ganoA, pa, pb);
    const nuevoA = ratingA0 + resElo.deltaA;
    const nuevoB = ratingB0 + resElo.deltaB;

    const ctx = { ganador, pa, pb, nombreA: partido.a, nombreB: partido.b };
    const apuestasResueltas = partido.apuestas.map((ap) => {
      if (ap.tipo === "combinada") {
        const patasResueltas = ap.patas.map((p) => {
           const aciertoPata = evaluarPata(p.mercado, p.seleccion, ctx, customResults);
           return { ...p, acertada: aciertoPata };
        });
        const todasAciertan = patasResueltas.every((p) => p.acertada);
        return { ...ap, patas: patasResueltas, estado: todasAciertan ? "ganada" : "perdida" };
      }
      
      const acierto = evaluarPata(ap.mercado, ap.seleccion, ctx, customResults);
      return { ...ap, estado: acierto ? "ganada" : "perdida" };
    });

    const nuevosBettors = { ...estado.bettors };
    apuestasResueltas.forEach((ap) => {
      if (ap.estado === "ganada") {
        nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] ?? 500) + ap.stake * ap.cuota).toFixed(2));
      }
    });

    const partidoCerrado = {
      ...partido, pa, pb, ganador, perdedor,
      teamA: [partido.a], teamB: [partido.b],
      aLabel: partido.a, bLabel: partido.b,
      ratingsAntes: { [partido.a]: ratingA0, [partido.b]: ratingB0 },
      ratingsDespues: { [partido.a]: nuevoA, [partido.b]: nuevoB },
      apuestas: apuestasResueltas,
      fecha: new Date().toISOString(),
    };
    const coronacion = !!(gm && gm !== estado.gm);
    const rachaRota = calcularRacha(estado.historial || [], perdedor) >= 3;
    partidoCerrado.titular = generarTitular(partidoCerrado, coronacion, rachaRota);

    if (gm && gm !== estado.gm) setCelebracion({ nombre: gm, tipo: "gm" });

    persistir({
      ...estado,
      jugadores: { ...estado.jugadores, [partido.a]: nuevoA, [partido.b]: nuevoB },
      gm, pendiente, bettors: nuevosBettors, partidoAbierto: null,
      historial: [partidoCerrado, ...(estado.historial || [])],
    });
    setMarcador({ a: "", b: "" });
    setResolviendoCustoms(null);
  }

  function eliminarPartidoHistorial(idPartido) {
    const partidoABorrar = (estado.historial || []).find(p => p.id === idPartido);
    if (!partidoABorrar) return;

    if (window.confirm("¿Seguro que quieres borrar este partido del historial? Se devolverán las fichas y se restaurará el ELO.")) {
      const nuevoHistorial = (estado.historial || []).filter((p) => p.id !== idPartido);
      let nuevosJugadores = { ...estado.jugadores };
      let nuevosBettors = { ...estado.bettors };

      if ((estado.historial || [])[0]?.id === idPartido) {
        if (partidoABorrar.ratingsAntes) {
          Object.entries(partidoABorrar.ratingsAntes).forEach(([jugador, eloAnterior]) => {
            nuevosJugadores[jugador] = eloAnterior;
          });
        }
        if (partidoABorrar.apuestas) {
          partidoABorrar.apuestas.forEach(ap => {
             if (ap.estado === "ganada") {
                nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] || 0) - (ap.stake * ap.cuota) + ap.stake).toFixed(2));
             } else if (ap.estado === "perdida") {
                nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] || 0) + ap.stake).toFixed(2));
             }
          });
        }
      }

      persistir({
        ...estado,
        historial: nuevoHistorial,
        jugadores: nuevosJugadores,
        bettors: nuevosBettors
      });
    }
  }

  async function borrarTodo() {
    await persistir(ESTADO_DEFECTO);
    setConfirmBorrar(false);
  }

  // --- DERIVACIÓN DE DATOS PARA LA VISTA ---
  let pA_punto = null, mercados = null, ctxPartido = null;

  if (partido) {
    ctxPartido = { ladoA: partido.ladoA, ladoB: partido.ladoB, solLado: partido.solLado, viento: partido.viento, esGM: partido.esGM };
    pA_punto = calcularProbabilidadPuntoPura(estado.historial || [], partido.a, partido.b, ctxPartido);
    mercados = calcularMercadosDesdeProbabilidad(pA_punto, estado.margen, partido.a, partido.b);
  }

  const stakeGanadorA = partido ? sumaStakeGanador(partido.apuestas, partido.a) : 0;
  const stakeGanadorB = partido ? sumaStakeGanador(partido.apuestas, partido.b) : 0;
  const ganadorConDinero = mercados ? cuotaGanadorConDinero(mercados.ganador.pA, estado.margen, stakeGanadorA, stakeGanadorB) : null;
  
  const conBoost = (mercado, seleccion, base) => {
    const b = partido ? boostDe(partido, mercado, seleccion) : null;
    const isLocked = b === "LOCKED";
    const valorReal = isLocked ? null : (b ?? base);
    const esRealBoost = b !== null && !isLocked && b > base;
    return { valor: valorReal, base, boosteado: !modoEspectador && esRealBoost, locked: isLocked };
  };

  const bGanadorA = ganadorConDinero ? conBoost("Ganador", partido.a, ganadorConDinero.A) : null;
  const bGanadorB = ganadorConDinero ? conBoost("Ganador", partido.b, ganadorConDinero.B) : null;
  const rachaA = partido ? calcularRacha(estado.historial || [], partido.a) : 0;
  const rachaB = partido ? calcularRacha(estado.historial || [], partido.b) : 0;
  
  // Limitar handicap al realismo de la probabilidad
  let maxHandicap = 3;
  if (mercados) {
      for(let k=4; k<=19; k++){
          const match = mercados.handicaps.find(h => h.k === k);
          if(match && Math.min(match.cuotaA, match.cuotaB) < 15) maxHandicap = k;
      }
  }
  const rangoH = partido && mercados ? { min: 3, max: Math.max(3, maxHandicap) } : { min: 3, max: 10 };
  const handicapKClamp = Math.min(rangoH.max, Math.max(rangoH.min, handicapK));
  const handicapVivo = mercados ? mercados.handicaps.find(h => h.k === handicapKClamp) : null;

  const lineaAClamp = mercados ? Math.min(21, Math.max(0, lineaA)) : 12;
  const lineaBClamp = mercados ? Math.min(21, Math.max(0, lineaB)) : 12;
  
  let pMasLineaA = 0, pMasLineaB = 0;
  if(mercados){
      mercados.terminales.forEach(t => {
          if (t.a > lineaAClamp) pMasLineaA += t.p;
          if (t.b > lineaBClamp) pMasLineaB += t.p;
      });
  }
  const puntosAVivo = mercados ? { cuotaMas: cuota(pMasLineaA, estado.margen), cuotaMenos: cuota(1-pMasLineaA, estado.margen) } : null;
  const puntosBVivo = mercados ? { cuotaMas: cuota(pMasLineaB, estado.margen), cuotaMenos: cuota(1-pMasLineaB, estado.margen) } : null;

  const variacionA0 = puntosAVivo ? ladoConSentido(puntosAVivo.cuotaMas, puntosAVivo.cuotaMenos) : { mostrarMas: true, mostrarMenos: true };
  const variacionB0 = puntosBVivo ? ladoConSentido(puntosBVivo.cuotaMas, puntosBVivo.cuotaMenos) : { mostrarMas: true, mostrarMenos: true };
  const handicapLados0 = handicapVivo ? ladoConSentido(handicapVivo.cuotaA, handicapVivo.cuotaB) : { mostrarMas: true, mostrarMenos: true };

  const isEditing = modoEditarCuotas && !modoEspectador;
  const variacionA = isEditing ? { mostrarMas: true, mostrarMenos: true } : variacionA0;
  const variacionB = isEditing ? { mostrarMas: true, mostrarMenos: true } : variacionB0;
  const handicapLados = isEditing ? { mostrarMas: true, mostrarMenos: true } : handicapLados0;
  const bHandicapA = handicapVivo ? conBoost(`Hándicap ${handicapKClamp}`, partido.a, handicapVivo.cuotaA) : null;
  const bHandicapB = handicapVivo ? conBoost(`Hándicap ${handicapKClamp}`, partido.b, handicapVivo.cuotaB) : null;
  const bPuntosAMas = puntosAVivo ? conBoost(`Puntos ${partido?.a} ${lineaAClamp}`, "Más", puntosAVivo.cuotaMas) : null;
  const bPuntosAMenos = puntosAVivo ? conBoost(`Puntos ${partido?.a} ${lineaAClamp}`, "Menos", puntosAVivo.cuotaMenos) : null;
  const bPuntosBMas = puntosBVivo ? conBoost(`Puntos ${partido?.b} ${lineaBClamp}`, "Más", puntosBVivo.cuotaMas) : null;
  const bPuntosBMenos = puntosBVivo ? conBoost(`Puntos ${partido?.b} ${lineaBClamp}`, "Menos", puntosBVivo.cuotaMenos) : null;
  const bComoParciales = mercados ? conBoost("Cómo termina", "parciales", mercados.comoTermina.parciales) : null;
  const bComoNormal = mercados ? conBoost("Cómo termina", "normal", mercados.comoTermina.normal) : null;
  const bComoAjustado = mercados ? conBoost("Cómo termina", "ajustado", mercados.comoTermina.ajustado) : null;
  
  const hayBoostsActivos = partido?.boosts && Object.values(partido.boosts).some(v => typeof v === "number" && v > 1.01);
  const totalSlipStake = slip.reduce((s, x) => s + x.stake, 0);
  const totalSlipPremio = slip.reduce((s, x) => s + x.stake * x.cuota, 0);

  const pAInt = parseInt(ptsCreatorA);
  const pBInt = parseInt(ptsCreatorB);
  const hasA = !isNaN(pAInt);
  const hasB = !isNaN(pBInt);

  let isValScore = false;
  let cuotaPartido = null;
  if (hasA && hasB) {
      if (isValidScore(pAInt, pBInt)) {
          isValScore = true;
          if (mercados) cuotaPartido = cuota(probDesdeTerminales(mercados.terminales, pAInt, pBInt), estado.margen);
      }
  }

  const cuotaPtsA = (hasA && pAInt >= 0 && mercados) ? cuota(probPuntosIndividual(mercados.terminales, pAInt, true), estado.margen) : null;
  const cuotaPtsB = (hasB && pBInt >= 0 && mercados) ? cuota(probPuntosIndividual(mercados.terminales, pBInt, false), estado.margen) : null;

  const bPtsA = cuotaPtsA ? conBoost(`Puntos Exactos ${partido?.a}`, String(pAInt), cuotaPtsA) : null;
  const bPtsB = cuotaPtsB ? conBoost(`Puntos Exactos ${partido?.b}`, String(pBInt), cuotaPtsB) : null;
  const bResPartido = cuotaPartido ? conBoost(`Resultado Exacto Partido`, `${pAInt}-${pBInt}`, cuotaPartido) : null;

  const rankingBettors = Object.entries(estado.bettors).sort((a, b) => b[1] - a[1]);
  const podio = rankingBettors.slice(0, 3);
  const resto = rankingBettors.slice(3);
  const estadisticasApostantes = calcularEstadisticasApostantes(estado.historial || [], estado.bettors || {});
  const rankingEstilo = calcularRankingEstilo(estado.historial || []);
  const statsCampos = calcularEstadisticasGlobales(estado.historial || []);

  const TABS = [
    { id: "partido", label: "Apuestas", icon: Swords },
    { id: "jugadores", label: "Jugadores", icon: Users },
    { id: "historial", label: "Historial", icon: History },
  ];

  return (
    <div className="min-h-screen c-bg-app c-text-1 pb-24" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=Space+Mono&family=Caveat:wght@600;700&display=swap');
        :root { color-scheme: light; }
        html, body { background: #F3F5F8; margin: 0; }
        @keyframes fadeIn { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
        @keyframes caer { from { transform: translateY(0) rotate(0deg); opacity:1; } to { transform: translateY(110vh) rotate(340deg); opacity:0.9; } }
        @keyframes stampIn { 0% { opacity:0; transform: scale(0.7) rotate(-10deg);} 70% { opacity:1; transform: scale(1.04) rotate(2deg);} 100% { transform: scale(1) rotate(0deg);} }
        @keyframes fabPop { 0% { transform: scale(1);} 40% { transform: scale(1.18);} 100% { transform: scale(1);} }
        @keyframes rebote { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-3px) rotate(-8deg); } }
        @keyframes pulsoBoost { 0%, 100% { box-shadow: 0 0 6px 1px rgba(255,90,31,0.55); } 50% { box-shadow: 0 0 14px 4px rgba(255,90,31,0.85); } }
        .boost-cuota {
          background: linear-gradient(135deg, #FF5A1F 0%, #FF8A00 50%, #0E6E4E 100%);
          animation: pulsoBoost 1.6s ease-in-out infinite;
          transform: scale(1.06);
        }
        input::placeholder { color: #6B7280; }
        input[type="checkbox"] { accent-color: #FF5A1F; width: 15px; height: 15px; }

        .c-bg-app { background-color: #F3F5F8 !important; }
        .c-bg-white { background-color: #FFFFFF !important; }
        .c-bg-white-95 { background-color: rgba(255,255,255,0.95) !important; }
        .c-bg-orange { background-color: #FF5A1F !important; }
        .c-bg-mesa { background-color: #0E6E4E !important; }
        .c-bg-mesa-15 { background-color: rgba(14,110,78,0.14) !important; }
        .c-text-mesa { color: #0E6E4E !important; }
        .c-bd-mesa { border-color: #0E6E4E !important; }
        .c-bd-mesa-40 { border-color: rgba(14,110,78,0.4) !important; }
        .c-red-net { background: repeating-linear-gradient(90deg, #0E6E4E 0 10px, transparent 10px 18px); }
        .c-bg-orange-20 { background-color: rgba(255,90,31,0.2) !important; }
        .c-bg-gold { background-color: #8A6D1D !important; }
        .c-bg-gold-soft { background-color: #FFF3D6 !important; }
        .c-bg-red { background-color: #DC2626 !important; }
        .c-bg-red-soft { background-color: #FEE2E2 !important; }
        .c-bg-green { background-color: #16A34A !important; }
        .c-bg-green-soft { background-color: #DCFCE7 !important; }
        .c-bg-blue-soft { background-color: #DBEAFE !important; }
        
        .c-bg-blue { background-color: #3B82F6 !important; }
        .c-text-blue { color: #2563EB !important; }
        .c-bg-teal { background-color: #14B8A6 !important; }
        .c-text-teal { color: #0D9488 !important; }

        .c-grad-panel { background: linear-gradient(to bottom, #FBFCFD, #FFFFFF) !important; }
        .c-grad-banner { background: linear-gradient(to right, #F3F5F8, #FFFFFF) !important; }
        .c-grad-podio { background: linear-gradient(to top, #F3F5F8, #DDE2E9) !important; }

        .c-bd-1 { border-color: #DDE2E9 !important; }
        .c-bd-1-60 { border-color: rgba(221,226,233,0.6) !important; }
        .c-bd-2 { border-color: #E2E6EC !important; }
        .c-bd-2b { border-color: #D8DEE6 !important; }
        .c-bd-orange { border-color: #FF5A1F !important; }
        .c-bd-orange-50 { border-color: rgba(255,90,31,0.5) !important; }
        .c-bd-orange-60 { border-color: rgba(255,90,31,0.6) !important; }
        .c-bd-gold-30 { border-color: rgba(138,109,29,0.3) !important; }
        .c-bd-gold-50 { border-color: rgba(138,109,29,0.5) !important; }
        .c-bd-red-40 { border-color: rgba(220,38,38,0.4) !important; }
        .c-bd-red-50 { border-color: rgba(220,38,38,0.5) !important; }
        .c-bd-green-50 { border-color: rgba(22,163,74,0.5) !important; }
        .c-bd-blue-50 { border-color: rgba(147,197,253,0.5) !important; }

        .c-text-1 { color: #14181F !important; }
        .c-text-2 { color: #5B6472 !important; }
        .c-text-3 { color: #3F4753 !important; }
        .c-text-4 { color: #9CA3AF !important; }
        .c-text-orange { color: #C2410C !important; }
        .c-text-orange-lg { color: #FF5A1F !important; }
        .c-text-dark-on-accent { color: #1A0D05 !important; }
        .c-text-dark-on-accent-70 { color: rgba(26,13,5,0.7) !important; }
        .c-text-green { color: #15803D !important; }
        .c-text-green-dark { color: #06210F !important; }
        .c-text-gold { color: #7A5D18 !important; }
        .c-text-red { color: #C81E1E !important; }
        .c-text-red2 { color: #B91C1C !important; }

        .c-shadow-glow-orange { box-shadow: 0 0 16px rgba(255,90,31,0.45) !important; }
        .c-shadow-card { box-shadow: 0 2px 10px rgba(15,23,42,0.08) !important; }
        .c-shadow-fab { box-shadow: 0 6px 20px rgba(255,90,31,0.5) !important; }

        .c-anim-stampin { animation: stampIn .35s cubic-bezier(0.34,1.56,0.64,1) !important; }
        .c-anim-fadein-3 { animation: fadeIn .3s ease !important; }
        .c-anim-fadein-2 { animation: fadeIn .2s ease !important; }
        .c-anim-fadein-25 { animation: fadeIn .25s ease !important; }

        .c-minw-84 { min-width: 84px !important; }
        .c-tracking-wide2 { letter-spacing: 0.2em !important; }
        .c-z60 { z-index: 60 !important; }
        .c-maxh-80vh { max-height: 80vh !important; }
      `}</style>

      {celebracion && <Confeti nombre={celebracion.nombre} tipo={celebracion.tipo} onFin={() => setCelebracion(null)} />}

      <div className="sticky top-0 z-30 c-bg-white-95 backdrop-blur px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl inline-block" style={{ animation: "rebote 2.2s ease-in-out infinite" }}>🏓</span>
            <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }} className="text-2xl c-text-1 leading-none">
              <span className="c-text-orange">PINO-PONG</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => (modoEspectador ? pedirModoBoss() : pasarAEspectador())} title="Modo espectador / boss" className={modoEspectador ? "c-text-orange" : "c-text-2 hover:c-text-1 transition-colors"}>
              {modoEspectador ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            {!modoEspectador && (
              <button onClick={() => setConfirmBorrar(true)} title="Borrar todo" className="c-text-2 hover:c-text-1 transition-colors">
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="c-red-net h-[3px] w-full mt-3 rounded-full opacity-70" />
        <p className="text-[10px] c-text-3 font-semibold mt-1">Donde se demuestra quién tiene de verdad madera de campeones.</p>
        
        {modoEspectador && (
          <div className="mt-1.5"><Chip tone="info">👁️ Espectador: apostar sí, gestión con clave</Chip></div>
        )}
        {estado.gm ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs c-text-2 flex-wrap">
            <Avatar name={estado.gm} size={18} />
            <span>Gran Maestro: <b className="c-text-1">{estado.gm}</b></span>
            {estado.pendiente && <Chip tone="live">{estado.pendiente} a un paso</Chip>}
          </div>
        ) : (
          <div className="mt-1.5 text-xs c-text-2">Sin Gran Maestro designado todavía</div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {error && (
          <div className="text-sm c-bg-red-soft border c-bd-red-40 c-text-red2 rounded-lg px-3 py-2 flex justify-between shadow-sm">
            <span>{error}</span>
            <button onClick={() => setError("")}><X size={14} /></button>
          </div>
        )}

        {tab === "partido" && !partido && modoEspectador && (
          <Panel icon={Eye} titulo="Modo espectador">
            <p className="text-sm c-text-2">No hay ningún partido en juego ahora mismo. Vuelve al modo boss (arriba a la derecha) si quieres montar uno.</p>
          </Panel>
        )}
        {tab === "partido" && !partido && !modoEspectador && (
          <Panel icon={Swords} titulo="Montar un partido nuevo">
            {nombresJugadores.length === 0 && (estado.historial || []).length === 0 && (
              <button onClick={() => persistir(construirEstadoDesdeHistorialReal())} className="w-full rounded-lg border border-dashed c-bd-orange-50 c-text-orange text-sm font-semibold py-2.5 mb-1">
                📋 Cargar los partidos ya jugados
              </button>
            )}
            {nombresJugadores.length < 2 ? (
              <p className="text-sm c-text-2">Da de alta al menos 2 jugadores en la pestaña "Jugadores" para empezar.</p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <select value={selA} onChange={(e) => setSelA(e.target.value)} style={{ colorScheme: "light" }} className="rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1">
                    <option value="">Jugador A</option>
                    {nombresJugadores.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <select value={selB} onChange={(e) => setSelB(e.target.value)} style={{ colorScheme: "light" }} className="rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1">
                    <option value="">Jugador B</option>
                    {nombresJugadores.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>

                <div className="rounded-lg c-bg-app border c-bd-1 p-2.5 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide c-text-2">Condiciones del partido</div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="c-text-2" />
                    <input type="time" value={horaInput} onChange={(e) => setHoraInput(e.target.value)} style={{ colorScheme: "light" }} className="rounded-lg border c-bd-1 c-bg-app p-1.5 text-sm c-text-1 flex-1" />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="c-text-2 text-xs">{selA || "Jugador A"} juega en:</span>
                    <div className="flex rounded-lg overflow-hidden border c-bd-1">
                      {["Canasta", "Columpios"].map((lado) => (
                        <button key={lado} onClick={() => setLadoAInput(lado)} className={`px-2.5 py-1 text-xs font-semibold ${ladoAInput === lado ? "c-bg-orange c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>{lado}</button>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs c-text-2">{selB || "Jugador B"} juega en <b className="c-text-1">{ladoBAuto}</b></div>
                  <div className="flex gap-3 pt-1 flex-wrap items-center">
                    <label className="flex items-center gap-1.5 text-xs c-text-2">
                      <input type="checkbox" checked={!!solLadoInput} onChange={(e) => setSolLadoInput(e.target.checked ? "Canasta" : null)} />
                      <Sun size={13} /> Hay sol molestando
                    </label>
                    {solLadoInput && (
                      <div className="flex rounded-lg overflow-hidden border c-bd-1">
                        {["Canasta", "Columpios"].map((lado) => (
                          <button key={lado} onClick={() => setSolLadoInput(lado)} className={`px-2 py-1 text-[11px] font-semibold ${solLadoInput === lado ? "c-bg-gold c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>{lado}</button>
                        ))}
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs c-text-2">
                      <input type="checkbox" checked={vientoInput} onChange={(e) => setVientoInput(e.target.checked)} />
                      <Wind size={13} /> Hace viento
                    </label>
                  </div>
                </div>

                {(selA === estado.gm || selB === estado.gm) && estado.gm && (
                  <label className="flex items-center gap-2 text-sm c-text-2">
                    <input type="checkbox" checked={esGM} onChange={(e) => setEsGM(e.target.checked)} />
                    Es partido por la Gran Maestría
                  </label>
                )}
                <button onClick={crearPartido} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                  <Plus size={16} /> Abrir mesa de apuestas
                </button>
              </div>
            )}
          </Panel>
        )}

        {tab === "partido" && partido && mercados && (
          <div className="space-y-3">
            <div className="rounded-xl c-grad-banner border c-bd-1 p-3">
              <div className="flex items-center justify-between">
                <Chip tone="live">● en juego</Chip>
                {partido.esGM && <Chip tone="gold"><Crown size={10} className="inline -mt-0.5" /> título en juego</Chip>}
                {!modoEspectador && <button onClick={cancelarPartido} className="c-text-2 hover:c-text-1 text-xs underline">cancelar partido</button>}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Avatar name={partido.a} size={32} />
                <div style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-2xl tracking-wide c-text-1">
                  {partido.a} <span className="c-text-2 text-base">vs</span> {partido.b}
                </div>
                <Avatar name={partido.b} size={32} />
              </div>
              <CondicionesBadges hora={partido.hora} ladoA={partido.ladoA} ladoB={partido.ladoB} solLado={partido.solLado} viento={partido.viento} nombreA={partido.a} nombreB={partido.b} />
            </div>

            {partido.esGM && (estado.gm === partido.a || estado.gm === partido.b) && (
              <div className="text-xs c-bg-gold-soft border c-bd-gold-30 rounded-lg px-3 py-2 c-text-gold">
                {(() => {
                  const retador = estado.gm === partido.a ? partido.b : partido.a;
                  const yaEsPendiente = estado.pendiente === retador;
                  return `Si gana ${retador}, ${yaEsPendiente ? "se corona nuevo Gran Maestro 👑" : "pasa a ser Maestro (retador)"}.`;
                })()}
              </div>
            )}

            <Panel icon={Trophy} titulo="Ganador" badge={
              !modoEspectador && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setModalNuevoMercado(true)} className="text-[10px] underline font-bold c-text-blue">
                    ➕ Añadir mercado libre
                  </button>
                  <button onClick={() => setModoEditarCuotas(!modoEditarCuotas)} className={`text-[10px] underline font-bold ${modoEditarCuotas ? "c-text-mesa" : "c-text-orange"}`}>
                    {modoEditarCuotas ? "✓ editando cuotas" : "✏️ editar cuotas"}
                  </button>
                </div>
              )
            }>
              {(Math.abs(rachaA) >= 3 || Math.abs(rachaB) >= 3) && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {Math.abs(rachaA) >= 3 && <Chip tone={rachaA > 0 ? "gold" : "info"}>{rachaA > 0 ? "🔥" : "❄️"} {partido.a} {Math.abs(rachaA)} seguidas</Chip>}
                  {Math.abs(rachaB) >= 3 && <Chip tone={rachaB > 0 ? "gold" : "info"}>{rachaB > 0 ? "🔥" : "❄️"} {partido.b} {Math.abs(rachaB)} seguidas</Chip>}
                </div>
              )}
              {hayBoostsActivos && !modoEspectador && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  <Chip tone="gold">🔥 hay cuotas ajustadas/mejoradas en esta mesa</Chip>
                </div>
              )}
              {!bGanadorA.boosteado && !bGanadorB.boosteado && ganadorConDinero && Math.abs(ganadorConDinero.ajuste) > 0.01 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  <Chip tone="info">
                    ⚖️ {stakeGanadorA > stakeGanadorB ? partido.a : partido.b} acumula más volumen en caja
                  </Chip>
                </div>
              )}
              <div className="flex gap-2">
                <BotonCuota isEditing={isEditing} etiqueta={partido.a} valor={bGanadorA.valor} valorBase={bGanadorA.base} boosteado={bGanadorA.boosteado} locked={bGanadorA.locked} activo={!!estaEnSlip("Ganador", partido.a)} onClick={() => manejarClicCuota("Ganador", partido.a, ganadorConDinero.A, partido.a)} />
                <BotonCuota isEditing={isEditing} etiqueta={partido.b} valor={bGanadorB.valor} valorBase={bGanadorB.base} boosteado={bGanadorB.boosteado} locked={bGanadorB.locked} activo={!!estaEnSlip("Ganador", partido.b)} onClick={() => manejarClicCuota("Ganador", partido.b, ganadorConDinero.B, partido.b)} />
              </div>
            </Panel>

            <Panel icon={Ticket} titulo="Creador de Resultados y Puntos">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1">
                  <div className="text-[10px] font-bold c-text-2 uppercase mb-1">Pts de {partido.a}</div>
                  <input type="number" inputMode="numeric" value={ptsCreatorA} onChange={e => setPtsCreatorA(e.target.value)} placeholder="0" className="w-full rounded-lg border c-bd-1 c-bg-white p-2 text-center text-lg font-bold c-text-1 shadow-sm" />
                </div>
                <div className="text-xl c-text-3 font-bold mt-4">-</div>
                <div className="flex-1">
                  <div className="text-[10px] font-bold c-text-2 uppercase mb-1">Pts de {partido.b}</div>
                  <input type="number" inputMode="numeric" value={ptsCreatorB} onChange={e => setPtsCreatorB(e.target.value)} placeholder="0" className="w-full rounded-lg border c-bd-1 c-bg-white p-2 text-center text-lg font-bold c-text-1 shadow-sm" />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex gap-2">
                  {cuotaPtsA !== null && ptsCreatorA !== "" && (
                     <BotonCuota isEditing={isEditing}
                       etiqueta={`${partido.a} hace`} sub={`${ptsCreatorA} pts exactos`} 
                       valor={bPtsA?.valor ?? cuotaPtsA} valorBase={cuotaPtsA} boosteado={bPtsA?.boosteado} locked={bPtsA?.locked}
                       activo={!!estaEnSlip(`Puntos Exactos ${partido.a}`, String(pAInt))} 
                       onClick={() => manejarClicCuota(`Puntos Exactos ${partido.a}`, String(pAInt), cuotaPtsA, `${partido.a} hace ${pAInt} pts`)} 
                     />
                  )}
                  {cuotaPtsB !== null && ptsCreatorB !== "" && (
                     <BotonCuota isEditing={isEditing}
                       etiqueta={`${partido.b} hace`} sub={`${ptsCreatorB} pts exactos`} 
                       valor={bPtsB?.valor ?? cuotaPtsB} valorBase={cuotaPtsB} boosteado={bPtsB?.boosteado} locked={bPtsB?.locked}
                       activo={!!estaEnSlip(`Puntos Exactos ${partido.b}`, String(pBInt))} 
                       onClick={() => manejarClicCuota(`Puntos Exactos ${partido.b}`, String(pBInt), cuotaPtsB, `${partido.b} hace ${pBInt} pts`)} 
                     />
                  )}
                </div>
                
                {isValScore && cuotaPartido !== null && (
                   <div className="pt-1 border-t c-bd-1 mt-1">
                     <BotonCuota isEditing={isEditing}
                       etiqueta="Terminan exactamente" sub={`${pAInt} - ${pBInt}`} 
                       valor={bResPartido?.valor ?? cuotaPartido} valorBase={cuotaPartido} boosteado={bResPartido?.boosteado} locked={bResPartido?.locked}
                       activo={!!estaEnSlip(`Resultado Exacto Partido`, `${pAInt}-${pBInt}`)} 
                       onClick={() => manejarClicCuota(`Resultado Exacto Partido`, `${pAInt}-${pBInt}`, cuotaPartido, `Quedan ${pAInt}-${pBInt}`)} 
                     />
                   </div>
                )}
                {!isValScore && ptsCreatorA !== "" && ptsCreatorB !== "" && (
                   <div className="text-[10px] c-text-2 text-center">
                     Ese resultado ({pAInt}-{pBInt}) no es un final válido de ping-pong (se juega a 21 y se gana por 2, o es un parcial: 7-0, 9-1, 11-2).
                   </div>
                )}
              </div>
            </Panel>

            {partido.mercadosCustom && partido.mercadosCustom.length > 0 && (
              <Panel icon={Plus} titulo="Mercados personalizados (Libre)">
                <div className="space-y-2">
                  {partido.mercadosCustom.map(custom => {
                    const activo = !!estaEnSlip(custom.mercado, custom.seleccion);
                    const bCustom = conBoost(custom.mercado, custom.seleccion, custom.cuota);
                    return (
                      <div key={custom.id} className="flex items-center gap-2">
                        <div className="flex-1">
                          <BotonCuota isEditing={isEditing}
                            etiqueta={`${custom.mercado}: ${custom.seleccion}`} 
                            valor={bCustom.valor ?? custom.cuota} 
                            valorBase={custom.cuota} 
                            boosteado={bCustom.boosteado} locked={bCustom.locked}
                            activo={activo} 
                            onClick={() => manejarClicCuota(custom.mercado, custom.seleccion, custom.cuota, `${custom.mercado} - ${custom.seleccion}`)} 
                          />
                        </div>
                        {!modoEspectador && (
                          <button onClick={() => eliminarMercadoCustom(custom.id)} className="text-red-500 hover:text-red-700 p-1">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            )}

            <Panel icon={Swords} titulo="Diferencia de puntos">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input type="range" min={rangoH.min} max={rangoH.max} step={1} value={handicapKClamp}
                    onChange={(e) => setHandicapK(Number(e.target.value))}
                    style={{ accentColor: "#FF5A1F" }} className="flex-1" />
                  <span className="text-sm font-bold c-text-1 w-16 text-right">≥ {handicapKClamp} pts</span>
                </div>
                {handicapVivo && (handicapLados.mostrarMas || handicapLados.mostrarMenos) && (
                  <div className="flex gap-2">
                    {handicapLados.mostrarMas && <BotonCuota isEditing={isEditing} etiqueta={`Gana ${partido.a}`} valor={bHandicapA.valor} valorBase={bHandicapA.base} boosteado={bHandicapA.boosteado} locked={bHandicapA.locked} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.a)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.a, handicapVivo.cuotaA, `Gana ${partido.a}`)} />}
                    {handicapLados.mostrarMenos && <BotonCuota isEditing={isEditing} etiqueta={`Gana ${partido.b}`} valor={bHandicapB.valor} valorBase={bHandicapB.base} boosteado={bHandicapB.boosteado} locked={bHandicapB.locked} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.b)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.b, handicapVivo.cuotaB, `Gana ${partido.b}`)} />}
                  </div>
                )}
              </div>
            </Panel>

            <Panel icon={Ticket} titulo="Más / menos puntos">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={0} max={21} step={1} value={lineaAClamp}
                      onChange={(e) => setLineaA(Number(e.target.value))}
                      style={{ accentColor: "#FF5A1F" }} className="flex-1" />
                    <span className="text-sm font-bold c-text-1 w-24 text-right">{partido.a}: {lineaAClamp}.5</span>
                  </div>
                  {puntosAVivo && (variacionA.mostrarMas || variacionA.mostrarMenos) && (
                    <div className="flex gap-2 mt-1">
                      {variacionA.mostrarMas && <BotonCuota isEditing={isEditing} etiqueta="Más de" sub={`${lineaAClamp}.5`} valor={bPuntosAMas.valor} valorBase={bPuntosAMas.base} boosteado={bPuntosAMas.boosteado} locked={bPuntosAMas.locked} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}.5`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}.5`, "Más", puntosAVivo.cuotaMas, `${partido.a} más de ${lineaAClamp}.5`)} />}
                      {variacionA.mostrarMenos && <BotonCuota isEditing={isEditing} etiqueta="Menos de" sub={`${lineaAClamp}.5`} valor={bPuntosAMenos.valor} valorBase={bPuntosAMenos.base} boosteado={bPuntosAMenos.boosteado} locked={bPuntosAMenos.locked} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}.5`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}.5`, "Menos", puntosAVivo.cuotaMenos, `${partido.a} menos de ${lineaAClamp}.5`)} />}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={0} max={21} step={1} value={lineaBClamp}
                      onChange={(e) => setLineaB(Number(e.target.value))}
                      style={{ accentColor: "#FF5A1F" }} className="flex-1" />
                    <span className="text-sm font-bold c-text-1 w-24 text-right">{partido.b}: {lineaBClamp}.5</span>
                  </div>
                  {puntosBVivo && (variacionB.mostrarMas || variacionB.mostrarMenos) && (
                    <div className="flex gap-2 mt-1">
                      {variacionB.mostrarMas && <BotonCuota isEditing={isEditing} etiqueta="Más de" sub={`${lineaBClamp}.5`} valor={bPuntosBMas.valor} valorBase={bPuntosBMas.base} boosteado={bPuntosBMas.boosteado} locked={bPuntosBMas.locked} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}.5`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}.5`, "Más", puntosBVivo.cuotaMas, `${partido.b} más de ${lineaBClamp}.5`)} />}
                      {variacionB.mostrarMenos && <BotonCuota isEditing={isEditing} etiqueta="Menos de" sub={`${lineaBClamp}.5`} valor={bPuntosBMenos.valor} valorBase={bPuntosBMenos.base} boosteado={bPuntosBMenos.boosteado} locked={bPuntosBMenos.locked} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}.5`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}.5`, "Menos", puntosBVivo.cuotaMenos, `${partido.b} menos de ${lineaBClamp}.5`)} />}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <Panel icon={Trophy} titulo="Cómo termina el partido">
              <div className="flex gap-2">
                <BotonCuota isEditing={isEditing} etiqueta="Parciales (rival ≤2)" valor={bComoParciales.valor} valorBase={bComoParciales.base} boosteado={bComoParciales.boosteado} locked={bComoParciales.locked} activo={!!estaEnSlip("Cómo termina", "parciales")} onClick={() => manejarClicCuota("Cómo termina", "parciales", mercados.comoTermina.parciales, "Parciales")} />
                <BotonCuota isEditing={isEditing} etiqueta="Normal (3-19)" valor={bComoNormal.valor} valorBase={bComoNormal.base} boosteado={bComoNormal.boosteado} locked={bComoNormal.locked} activo={!!estaEnSlip("Cómo termina", "normal")} onClick={() => manejarClicCuota("Cómo termina", "normal", mercados.comoTermina.normal, "Normal")} />
                <BotonCuota isEditing={isEditing} etiqueta="Ajustado (deuce)" valor={bComoAjustado.valor} valorBase={bComoAjustado.base} boosteado={bComoAjustado.boosteado} locked={bComoAjustado.locked} activo={!!estaEnSlip("Cómo termina", "ajustado")} onClick={() => manejarClicCuota("Cómo termina", "ajustado", mercados.comoTermina.ajustado, "Ajustado")} />
              </div>
              <p className="text-[10px] c-text-2 mt-1">Parciales: 7-0, 9-1, 11-2 o que el rival no pase de 2 (ej. 21-2). Normal: Terminar a 21 con el rival haciendo entre 3 y 19. Ajustado: 22-20, 23-21...</p>
            </Panel>

            {partido.apuestas.length > 0 && (
              <Panel icon={Ticket} titulo={`Apuestas de esta mesa (${partido.apuestas.length})`}>
                <div className="space-y-1">
                  {partido.apuestas.map((ap) => (
                    <div key={ap.id} className="flex items-center justify-between text-xs border-b c-bd-2 pb-1 c-text-3 hover:bg-black/5 transition-all p-1.5 -mx-1.5 rounded-md">
                      <div onClick={() => setDetalleApuestaVisible(ap)} className="flex-1 flex items-center gap-1.5 min-w-0 cursor-pointer">
                        <Avatar name={ap.bettor} size={16} />
                        <span className="font-semibold">{ap.bettor}</span>
                        <span className="truncate opacity-80">· {ap.tipo === "combinada" ? `Combinada (${ap.patas.length})` : `${ap.mercado} · ${ap.seleccion}`}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold c-text-orange shrink-0">{ap.stake.toFixed(2)} × {ap.cuota.toFixed(2)}</span>
                        {!modoEspectador && (
                           <button onClick={() => solicitarAccionProtegida("anular_apuesta", ap.id)} className="c-text-red2 hover:c-bg-red-soft p-1 rounded transition-colors" title="Anular apuesta">
                              <Trash2 size={14} />
                           </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] c-text-4 text-center mt-2">Pincha en el texto de cualquier apuesta para ver el detalle de la papeleta.</div>
              </Panel>
            )}

            {!modoEspectador && (
              <Panel icon={Check} titulo="Registrar resultado final">
                <div className="flex items-center gap-2">
                  <input inputMode="numeric" placeholder={partido.a} value={marcador.a} onChange={(e) => setMarcador({ ...marcador, a: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1 shadow-sm" />
                  <span className="c-text-2 font-bold">–</span>
                  <input inputMode="numeric" placeholder={partido.b} value={marcador.b} onChange={(e) => setMarcador({ ...marcador, b: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1 shadow-sm" />
                </div>
                <button onClick={iniciarCierrePartido} className="w-full mt-2 rounded-lg c-bg-green c-text-green-dark font-bold py-2.5 active:scale-95 transition-transform shadow-sm">
                  Cerrar mesa y liquidar apuestas
                </button>
              </Panel>
            )}
          </div>
        )}

        {tab === "jugadores" && (
          <div className="space-y-3">
            {!modoEspectador && (
              <Panel icon={Plus} titulo="Dar de alta un jugador">
                <div className="flex gap-2">
                  <input value={nuevoJugador} onChange={(e) => setNuevoJugador(e.target.value)} placeholder="Nombre" className="flex-1 rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1 shadow-inner" />
                  <button onClick={agregarJugador} className="rounded-lg c-bg-orange c-text-dark-on-accent px-4 font-bold active:scale-95 transition-transform shadow-sm">Añadir</button>
                </div>
              </Panel>
            )}
            
            <Panel icon={Users} titulo="Ranking actual">
              {nombresJugadores.length === 0 ? (
                <p className="text-sm c-text-2">Todavía no hay jugadores.</p>
              ) : (
                <div className="space-y-1">
                  {nombresJugadores.slice().sort((a, b) => estado.jugadores[b] - estado.jugadores[a]).map((n, i) => {
                    const racha = calcularRacha(estado.historial || [], n);
                    const stats = statsCampos.porJugador[n] || { cV:0, cD:0, kV:0, kD:0 };
                    const totalMatches = stats.cV + stats.cD + stats.kV + stats.kD;
                    
                    return (
                    <button key={n} onClick={() => setPerfilAbierto(n)} className="w-full flex items-center justify-between rounded-lg c-bg-app px-3 py-2 border c-bd-2 text-left active:scale-[0.98] transition-transform">
                      <div className="flex items-center gap-2 text-sm font-medium c-text-1 min-w-0">
                        <span className="c-text-2 text-xs w-4 shrink-0">{i + 1}</span>
                        <Avatar name={n} size={24} />
                        <span className="truncate font-semibold">{n}</span>
                        <span className="text-[9px] bg-white border c-bd-1 px-1.5 py-0.5 rounded-md c-text-3 font-semibold ml-0.5 shrink-0 shadow-sm">{totalMatches} p.</span>
                        {estado.gm === n && <Crown size={14} className="c-text-gold shrink-0 ml-1" />}
                        {estado.pendiente === n && <Chip tone="live">retador</Chip>}
                        {Math.abs(racha) >= 3 && <span className="shrink-0 ml-1">{racha > 0 ? "🔥" : "❄️"}</span>}
                        {!estado.gm && !modoEspectador && <span onClick={(e) => { e.stopPropagation(); fijarGMInicial(n); }} className="text-[10px] underline c-text-orange shrink-0 ml-1">hacer GM</span>}
                      </div>
                      <span className="font-mono text-sm c-text-orange font-bold shrink-0">{estado.jugadores[n].toFixed(2)}</span>
                    </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel icon={Target} titulo="📊 Estadísticas Globales">
              <div className="grid grid-cols-2 gap-3 mb-4">
                 <div className="c-bg-app p-3 rounded-lg border c-bd-2 text-center shadow-sm">
                    <div className="text-[10px] font-bold uppercase tracking-wider c-text-2 mb-1">Partidos Jugados</div>
                    <div className="font-bold text-2xl c-text-1">{(estado.historial || []).length}</div>
                 </div>
                 <div className="c-bg-app p-3 rounded-lg border c-bd-2 text-center shadow-sm">
                    <div className="text-[10px] font-bold uppercase tracking-wider c-text-2 mb-1">Fichas en Circuito</div>
                    <div className="font-bold text-2xl c-text-orange">
                       {Object.values(estado.bettors).reduce((a,b) => a + b, 0).toFixed(0)}
                    </div>
                 </div>
              </div>

              {(estado.historial || []).length > 0 && (
                <div className="space-y-4">
                  {/* RESUMEN GLOBAL CAMPOS */}
                  <div className="bg-white border c-bd-2 rounded-xl p-3 shadow-sm border-l-4" style={{borderLeftColor: '#3B82F6'}}>
                     <h4 className="text-[10px] uppercase font-bold c-text-2 mb-2 flex items-center gap-1"><MapPin size={12}/> Visión Global de Campos</h4>
                     <StatBar 
                        title="Victoria media por lado de mesa" 
                        w={statsCampos.totales.canasta} 
                        l={statsCampos.totales.columpios} 
                        barClass="c-bg-blue"
                        textClass="c-text-blue" 
                     />
                     <div className="flex justify-between text-[10px] c-text-3 font-semibold mt-1">
                        <span>Lado Canasta ({statsCampos.totales.canasta}V)</span>
                        <span>Lado Columpios ({statsCampos.totales.columpios}V)</span>
                     </div>
                  </div>

                  {/* RESUMEN GLOBAL CLIMA */}
                  <div className="bg-white border c-bd-2 rounded-xl p-3 shadow-sm border-l-4" style={{borderLeftColor: '#EAB308'}}>
                     <h4 className="text-[10px] uppercase font-bold c-text-2 mb-2 flex items-center gap-1"><Sun size={12}/> Impacto del Sol</h4>
                     <StatBar 
                        icon={Sun} 
                        title="Sobrevivir al Sol en contra" 
                        w={statsCampos.totales.solMataJugador} 
                        l={statsCampos.totales.solTot - statsCampos.totales.solMataJugador} 
                        barClass="c-bg-gold"
                        textClass="c-text-gold" 
                     />
                     <p className="text-[9px] c-text-4 text-center mt-2 leading-tight px-2">
                        Porcentaje de partidos donde el jugador que tenía el sol molestándole de cara consiguió sobreponerse y ganar.
                     </p>
                  </div>
                </div>
              )}
            </Panel>

            <Panel icon={Ticket} titulo="🎲 Mejor ludao del verano">
              {rankingBettors.length === 0 ? (
                <p className="text-sm c-text-2">Nadie ha apostado todavía. Cada apostante empieza con 500 fichas.</p>
              ) : (
                <div className="space-y-2">
                  {podio.length > 0 && (
                    <div className="flex items-end justify-center gap-2 pt-1 pb-2">
                      {[podio[1], podio[0], podio[2]].map((entry, idx) => {
                        if (!entry) return <div key={idx} className="w-16" />;
                        const [n, saldo] = entry;
                        const est = estadisticasApostantes[n] || { total: 0, aciertos: 0 };
                        const alturaOrden = idx === 1 ? "h-20" : idx === 0 ? "h-14" : "h-10";
                        const medalla = idx === 1 ? "🥇" : idx === 0 ? "🥈" : "🥉";
                        const vetado = estado.vetados?.includes(n);
                        return (
                          <div key={n} className="flex flex-col items-center gap-1 w-16 relative group">
                            {vetado && <div className="absolute top-0 right-0 c-text-red2 z-10"><Ban size={14} /></div>}
                            <div className="relative">
                              <Avatar name={n} size={26} />
                              {!modoEspectador && (
                                <button onClick={() => setModalDonar(n)} className="absolute -top-1 -right-2 bg-green-500 text-white rounded-full p-0.5 shadow-md active:scale-90 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Gift size={12} />
                                </button>
                              )}
                            </div>
                            <div className="text-[10px] c-text-1 font-semibold truncate w-full text-center">{n}</div>
                            <div className={`w-full ${alturaOrden} rounded-t-md c-grad-podio border c-bd-2b flex flex-col items-center justify-end pb-1`}>
                              <span className="text-lg">{medalla}</span>
                              <span className="text-[10px] font-mono font-bold c-text-orange">{saldo.toFixed(0)}</span>
                            </div>
                            {est.total > 0 && <div className="text-[9px] c-text-2">{est.aciertos}/{est.total} ({Math.round(100 * est.aciertos / est.total)}%)</div>}
                            {!modoEspectador && (
                               <div className="flex flex-col items-center mt-1">
                                 <button onClick={() => toggleVeto(n)} className="text-[8px] uppercase underline c-text-3 mb-1">{vetado ? "Quitar Veto" : "Vetar"}</button>
                                 <button onClick={() => solicitarAccionProtegida('eliminar_apostante', n)} className="c-text-red2 opacity-50 hover:opacity-100 transition-opacity p-1" title="Eliminar cuenta de apuestas"><Trash2 size={12} /></button>
                               </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {resto.map(([n, saldo], i) => {
                    const est = estadisticasApostantes[n] || { total: 0, aciertos: 0 };
                    const vetado = estado.vetados?.includes(n);
                    return (
                      <div key={n} className="flex justify-between items-center text-sm px-1 py-1 group">
                        <span className="flex items-center gap-2 c-text-3">
                           <span className="text-xs c-text-2 w-4">{i + 4}</span>
                           <div className="relative">
                              <Avatar name={n} size={20} />
                              {vetado && <div className="absolute -top-1 -right-1 c-text-red2 c-bg-white rounded-full"><Ban size={10} /></div>}
                           </div>
                           {n}
                        </span>
                        <span className="flex items-center gap-2">
                          {est.total > 0 && <span className="text-[10px] c-text-2">{est.aciertos}/{est.total} ({Math.round(100 * est.aciertos / est.total)}%)</span>}
                          <span className="font-mono font-bold c-text-1">{saldo.toFixed(2)}</span>
                          {!modoEspectador && (
                             <div className="flex items-center ml-1 border-l c-bd-2 pl-2 gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button onClick={() => setModalDonar(n)} className="text-green-600 hover:text-green-800" title="Añadir fichas"><Gift size={14} /></button>
                               <button onClick={() => toggleVeto(n)} className="c-text-2 hover:c-text-red2" title="Vetar/Desvetar"><Ban size={14} /></button>
                               <button onClick={() => solicitarAccionProtegida('eliminar_apostante', n)} className="c-text-red2" title="Eliminar Apostante"><Trash2 size={14} /></button>
                             </div>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {(rankingEstilo.reyParciales || rankingEstilo.reyDeuce) && (
              <Panel icon={Trophy} titulo="🏅 Estilos de la temporada">
                <div className="space-y-1.5 text-sm">
                  {rankingEstilo.reyParciales && (
                    <div className="flex justify-between"><span className="c-text-2">🥊 Rey de los parciales</span><span className="font-bold c-text-1">{rankingEstilo.reyParciales[0]} ({rankingEstilo.reyParciales[1].parciales})</span></div>
                  )}
                  {rankingEstilo.reyDeuce && (
                    <div className="flex justify-between"><span className="c-text-2">😅 Rey del deuce</span><span className="font-bold c-text-1">{rankingEstilo.reyDeuce[0]} ({rankingEstilo.reyDeuce[1].deuceGanados}/{rankingEstilo.reyDeuce[1].deuceJugados})</span></div>
                  )}
                </div>
              </Panel>
            )}

            {!modoEspectador && (
              <Panel icon={Swords} titulo="Margen de la casa">
                <div className="flex items-center justify-between">
                  <button onClick={() => persistir({ ...estado, margen: Math.max(0, +(estado.margen - 0.01).toFixed(2)) })} className="w-9 h-9 rounded-lg c-bg-app border c-bd-1 c-text-1 font-bold active:scale-90 transition-transform shadow-sm">–</button>
                  <span className="font-mono text-lg font-bold c-text-orange">{(estado.margen * 100).toFixed(0)}%</span>
                  <button onClick={() => persistir({ ...estado, margen: Math.min(0.3, +(estado.margen + 0.01).toFixed(2)) })} className="w-9 h-9 rounded-lg c-bg-app border c-bd-1 c-text-1 font-bold active:scale-90 transition-transform shadow-sm">+</button>
                </div>
              </Panel>
            )}
          </div>
        )}

        {tab === "historial" && (
          <div className="space-y-3">
            {(estado.historial || []).length > 0 && (
              <button onClick={exportarHistorial} className="w-full rounded-lg border border-dashed c-bd-orange c-text-orange text-sm font-semibold py-2.5 bg-white">
                ⬇️ Exportar historial a CSV
              </button>
            )}
            
            {(estado.historial || []).length === 0 ? (
              <Panel icon={History} titulo="Historial">
                <p className="text-sm c-text-2">Aún no se ha cerrado ningún partido.</p>
              </Panel>
            ) : (
              (estado.historial || []).map((p) => {
                const fechaObj = new Date(p.fecha);
                const fechaStr = fechaObj.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
                const horaStr = p.hora || fechaObj.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
                return (
                  <Panel 
                    key={p.id} 
                    icon={History} 
                    titulo={`${fechaStr} · ${horaStr}`}
                    badge={
                      !modoEspectador && (
                        <button onClick={() => eliminarPartidoHistorial(p.id)} className="text-xs c-text-red2 underline font-bold active:scale-95 transition-transform">
                          Borrar
                        </button>
                      )
                    }
                  >
                    {p.titular && <p style={{ fontFamily: "'Caveat', cursive" }} className="text-lg c-text-mesa font-bold leading-tight">"{p.titular}"</p>}
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-lg tracking-wide c-text-1 flex items-center gap-2 flex-wrap">
                      {p.aLabel} <span className={p.ganador === p.aLabel ? "c-text-green" : "c-text-red2"}>{p.pa}</span> – <span className={p.ganador === p.bLabel ? "c-text-green" : "c-text-red2"}>{p.pb}</span> {p.bLabel} {p.esGM && "👑"}
                    </div>
                    <CondicionesBadges hora={null} ladoA={p.ladoA} ladoB={p.ladoB} solLado={p.solLado} viento={p.viento} nombreA={p.aLabel} nombreB={p.bLabel} />
                    <div className="text-xs c-text-2">
                      Ganó <b className="c-text-green">{p.ganador}</b> · ratings:{" "}
                      {Object.entries(p.ratingsAntes).map(([n, antes], i) => (
                        <span key={n}>{i > 0 && ", "}{n} {antes.toFixed(0)}→{p.ratingsDespues[n].toFixed(0)}</span>
                      ))}
                    </div>
                    {p.apuestas.length > 0 && (
                      <div className="pt-1 space-y-0.5">
                        {p.apuestas.map((ap) => (
                          <div key={ap.id} onClick={() => setDetalleApuestaVisible(ap)} className={`text-xs flex justify-between p-1.5 -mx-1.5 rounded-md cursor-pointer hover:bg-black/5 active:scale-[0.98] transition-all ${ap.estado === "ganada" ? "c-text-green" : "c-text-red2"}`}>
                            <span className="truncate pr-2 font-medium">{ap.bettor} · {ap.tipo === "combinada" ? `Combinada (${ap.patas.length})` : `${ap.mercado} · ${ap.seleccion}`}</span>
                            <span className="font-bold shrink-0">{ap.estado === "ganada" ? `+${(ap.stake * ap.cuota).toFixed(2)}` : `-${ap.stake.toFixed(2)}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                );
              })
            )}
          </div>
        )}
      </div>

      {slip.length > 0 && !slipOpen && (
        <button
          onClick={() => setSlipOpen(true)}
          style={{ animation: fabPop ? "fabPop .26s ease" : "none" }}
          className="fixed bottom-20 right-4 z-40 c-bg-orange c-text-dark-on-accent rounded-full pl-3 pr-4 py-3 c-shadow-fab flex items-center gap-2 font-bold text-sm"
        >
          <Ticket size={18} /> {slip.length} · {totalSlipStake.toFixed(2)} fichas
        </button>
      )}

      <div className="fixed bottom-0 inset-x-0 z-40 c-bg-white-95 backdrop-blur border-t c-bd-mesa-40 flex justify-around py-2 px-2">
        {TABS.map((t) => {
          const activo = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-0.5 px-4 py-1 relative transition-transform active:scale-90">
              <div className={`rounded-lg px-3 py-1 transition-colors ${activo ? "c-bg-mesa-15" : ""}`}>
                <t.icon size={20} className={activo ? "c-text-mesa" : "c-text-2"} />
              </div>
              <span className={`text-[10px] font-semibold ${activo ? "c-text-mesa" : "c-text-2"}`}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {slipOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setSlipOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-t-2xl p-4 w-full max-w-md space-y-3 border-t c-bd-1 c-maxh-80vh overflow-y-auto c-anim-fadein-2 shadow-2xl">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1 flex items-center gap-1.5"><Ticket size={16} className="c-text-orange" /> Cesta de apuestas</div>
              <button onClick={() => setSlipOpen(false)} className="c-text-2"><X size={18} /></button>
            </div>
            
            {slipError && (
              <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2 font-medium shadow-sm">
                {slipError}
              </div>
            )}

            {slip.length === 0 ? (
              <p className="text-sm c-text-2">La cesta está vacía.</p>
            ) : (
              <div className="space-y-2">
                {slip.length >= 2 && (
                  <div className="flex rounded-lg overflow-hidden border c-bd-1 text-sm font-semibold shadow-sm">
                    <button onClick={() => setModoSlip("simples")} className={`flex-1 py-1.5 ${modoSlip === "simples" ? "c-bg-orange c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>Simples</button>
                    <button onClick={() => setModoSlip("combinada")} className={`flex-1 py-1.5 ${modoSlip === "combinada" ? "c-bg-orange c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>SGP (Combinada)</button>
                  </div>
                )}
                {slip.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 c-bg-app rounded-lg p-2 border c-bd-2 shadow-sm">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs c-text-2 truncate">{s.mercado}</div>
                      <div className="text-sm font-bold c-text-1">{s.seleccion} <span className="c-text-orange">Cuota: {s.cuota.toFixed(2)}</span></div>
                      {modoSlip === "simples" && (
                        <div className="text-[11px] c-text-green font-medium">Ganancia: {(s.stake * s.cuota).toFixed(2)} fichas</div>
                      )}
                    </div>
                    {modoSlip === "simples" || slip.length < 2 ? (
                      <input inputMode="decimal" value={s.stake} onChange={(e) => actualizarStakeSlip(s.id, e.target.value)} className="w-20 rounded-lg border c-bd-1 c-bg-white p-1.5 text-sm text-center c-text-1 shadow-inner" placeholder="Fichas" />
                    ) : null}
                    <button onClick={() => quitarDeSlip(s.id)} className="c-text-red2"><X size={16} /></button>
                  </div>
                ))}
                <input value={bettorSlip} onChange={(e) => setBettorSlip(e.target.value)} placeholder="¿Quién apuesta?" list="bettors-list" className="w-full rounded-lg border c-bd-1 c-bg-white p-2 text-sm c-text-1 shadow-inner" />
                <datalist id="bettors-list">{Object.keys(estado.bettors).map((n) => <option key={n} value={n} />)}</datalist>

                {modoSlip === "combinada" && slip.length >= 2 ? (
                  <>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm c-text-2 font-bold">Fichas a jugar</span>
                      <input inputMode="decimal" value={stakeCombinada} onChange={(e) => setStakeCombinada(e.target.value)} className="flex-1 rounded-lg border c-bd-1 c-bg-white p-1.5 text-sm text-center c-text-1 shadow-inner" />
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1 mt-2 bg-gray-50 p-2 rounded-md border c-bd-2">
                      <span className="font-semibold">Cuota conjunta inteligente</span>
                      <span className="font-bold c-text-orange">{calcularCuotaSGP(slip, mercados, partido, estado.margen).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span className="font-semibold">Premio si aciertas todas</span>
                      <span className="font-bold c-text-green">{(calcularCuotaSGP(slip, mercados, partido, estado.margen) * (Number(stakeCombinada.replace(',', '.')) || 0)).toFixed(2)} fichas</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm c-text-3 px-1 mt-2">
                      <span>Total apostado</span><span className="font-bold c-text-1">{totalSlipStake.toFixed(2)} fichas</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Premio máximo total</span><span className="font-bold c-text-green">{totalSlipPremio.toFixed(2)} fichas</span>
                    </div>
                  </>
                )}

                <button onClick={confirmarSlip} className="w-full mt-2 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 active:scale-95 transition-transform shadow-sm">
                  {modoSlip === "combinada" && slip.length >= 2 ? "Confirmar combinada" : `Confirmar ${slip.length} apuesta${slip.length > 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {ticketVisible && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3" onClick={() => setTicketVisible(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <TicketApuesta bettor={ticketVisible.bettor} apuestas={ticketVisible.apuestas} onCerrar={() => setTicketVisible(null)} />
          </div>
        </div>
      )}
      
      <ModalDetalleApuesta apuesta={detalleApuestaVisible} onCerrar={() => setDetalleApuestaVisible(null)} />

      {confirmBorrar && (
        <ModalConfirmar
          titulo="¿Borrar todos los datos?"
          mensaje="Se perderán jugadores, apuestas, fichas e historial. No se puede deshacer."
          onCancelar={() => setConfirmBorrar(false)}
          onConfirmar={borrarTodo}
          textoConfirmar="Borrar todo"
          peligro
        />
      )}

      {perfilAbierto && (
        <ModalPerfil
          nombre={perfilAbierto}
          perfil={construirPerfilJugador(estado.historial || [], perfilAbierto)}
          rating={ratingDe(perfilAbierto)}
          statsAvanzadas={statsCampos.porJugador[perfilAbierto]}
          onCerrar={() => setPerfilAbierto(null)}
        />
      )}

      {pidiendoPassword && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPidiendoPassword(false)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1 shadow-2xl">
            <div className="font-bold c-text-1">Volver al modo boss</div>
            <div className="text-sm c-text-2">Introduce la contraseña para poder gestionar partidos, jugadores y ajustes.</div>
            <input
              type="password" inputMode="numeric" value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmarPassword(); }}
              placeholder="Contraseña" autoFocus
              className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1"
            />
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setPidiendoPassword(false)} className="flex-1 rounded-lg border c-bd-1 c-text-2 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={confirmarPassword} className="flex-1 rounded-lg c-bg-orange c-text-dark-on-accent py-2 text-sm font-bold shadow-sm">Entrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ACCIONES PROTEGIDAS POR CONTRASEÑA */}
      {accionProtegida && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setAccionProtegida(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1 border-t-4 border-t-red-600 shadow-2xl">
            <div className="font-bold c-text-1 text-lg flex items-center gap-2">
              <Lock size={18} className="c-text-red2" /> Acción Peligrosa
            </div>
            <div className="text-sm c-text-2 leading-snug">
              {accionProtegida.tipo === 'anular_apuesta' && "Vas a anular una apuesta en firme y devolver el dinero al jugador. Pon la clave de Boss."}
              {accionProtegida.tipo === 'eliminar_apostante' && `Vas a eliminar a ${accionProtegida.payload} de la lista de apuestas y quitarle todas las fichas (sus estadísticas de jugador no se tocan). Pon la clave de Boss.`}
            </div>
            <input
              type="password" inputMode="numeric" value={pwdProtegida}
              onChange={(e) => setPwdProtegida(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ejecutarAccionProtegida(); }}
              placeholder="Contraseña (123457)" autoFocus
              className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1 shadow-inner"
            />
            {errProtegida && <div className="text-xs c-text-red2 font-semibold">{errProtegida}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setAccionProtegida(null)} className="flex-1 rounded-lg border c-bd-1 c-text-2 py-2 text-sm font-semibold">Atrás</button>
              <button onClick={ejecutarAccionProtegida} className="flex-1 rounded-lg bg-red-600 text-white py-2 text-sm font-bold shadow-sm">Autorizar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DONAR FICHAS */}
      {modalDonar && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setModalDonar(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1 border-t-4 border-t-green-500 shadow-2xl">
            <div className="font-bold c-text-1 text-lg flex items-center gap-2">
              <Gift size={18} className="text-green-600" /> Banco Central
            </div>
            <div className="text-sm c-text-2">
              Añade (o quita con el signo -) fichas manualmente a la cuenta de <b className="c-text-1">{modalDonar}</b>.
            </div>
            <input
              type="text" inputMode="decimal" value={cantidadDonar}
              onChange={(e) => setCantidadDonar(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") procesarDonacion(); }}
              placeholder="Ej: 100 o -50" autoFocus
              className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-lg text-center font-bold c-text-1 shadow-inner"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setModalDonar(null)} className="flex-1 rounded-lg border c-bd-1 c-text-2 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={procesarDonacion} className="flex-1 rounded-lg bg-green-500 text-white py-2 text-sm font-bold shadow-md">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {csvVisible !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-3" onClick={() => setCsvVisible(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-md space-y-2 border c-bd-1 shadow-2xl">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1">Historial exportado</div>
              <button onClick={() => setCsvVisible(null)} className="c-text-2"><X size={18} /></button>
            </div>
            <div className="text-xs c-text-2">Copia el texto de abajo y pégalo en Excel o Notas.</div>
            <textarea readOnly value={csvVisible} onClick={(e) => e.target.select()} className="w-full h-40 rounded-lg border c-bd-1 c-bg-app p-2 text-[11px] c-text-1 shadow-inner" style={{ fontFamily: "'Space Mono', monospace" }} />
            <button onClick={copiarCSV} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 shadow-sm">
              {csvCopiado ? "✓ Copiado" : "📋 Copiar todo"}
            </button>
          </div>
        </div>
      )}

      {editarCuotaObjetivo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditarCuotaObjetivo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1 shadow-2xl">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-[10px] uppercase font-bold c-text-2">Ajustar cuota manual</div>
                <div className="font-bold c-text-1">{editarCuotaObjetivo.etiqueta}</div>
                <div className="text-xs c-text-2">Cuota original: {editarCuotaObjetivo.valorBase.toFixed(2)}</div>
              </div>
              <button onClick={() => setEditarCuotaObjetivo(null)} className="c-text-2"><X size={18} /></button>
            </div>
            <input
              inputMode="decimal" value={editarCuotaInput} onChange={(e) => setEditarCuotaInput(e.target.value)}
              placeholder={editarCuotaObjetivo.valorBase.toFixed(2)} autoFocus disabled={editarCuotaObjetivo.isLocked}
              className={`w-full rounded-lg border c-bd-1 p-2 text-lg font-bold text-center c-text-1 shadow-inner ${editarCuotaObjetivo.isLocked ? "c-bg-app opacity-50" : "c-bg-white"}`}
            />
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <div className="flex gap-2">
              <button onClick={guardarCuotaEditada} disabled={editarCuotaObjetivo.isLocked} className="flex-1 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2 text-sm disabled:opacity-50 shadow-sm">Guardar</button>
              {boostDe(partido, editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion) && !editarCuotaObjetivo.isLocked && (
                <button onClick={quitarCuotaEditada} className="flex-1 rounded-lg border c-bd-1 c-text-2 font-bold py-2 text-sm shadow-sm">Restaurar</button>
              )}
            </div>
            {!editarCuotaObjetivo.isLocked ? (
               <button onClick={bloquearCuota} className="w-full flex items-center justify-center gap-1 rounded-lg c-bg-red-soft c-text-red2 border c-bd-red-40 font-bold py-2 text-sm mt-2">
                 <Lock size={14} /> Bloquear Cuota
               </button>
            ) : (
               <button onClick={quitarCuotaEditada} className="w-full flex items-center justify-center gap-1 rounded-lg c-bg-green-soft c-text-green-dark border c-bd-green-50 font-bold py-2 text-sm mt-2">
                 🔓 Desbloquear Cuota
               </button>
            )}
          </div>
        </div>
      )}

      {modalNuevoMercado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setModalNuevoMercado(false)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-sm space-y-3 border c-bd-1 shadow-2xl">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1">Añadir mercado personalizado</div>
              <button onClick={() => setModalNuevoMercado(false)} className="c-text-2"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs c-text-2 font-semibold">Nombre del mercado</label>
                <input value={nombreMercadoCustom} onChange={(e) => setNombreMercadoCustom(e.target.value)} placeholder="Ej. Saques directos de Jorge" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1 shadow-inner" />
              </div>
              <div>
                <label className="text-xs c-text-2 font-semibold">Selección o opción</label>
                <input value={seleccionMercadoCustom} onChange={(e) => setSeleccionMercadoCustom(e.target.value)} placeholder="Ej. Más de 3" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1 shadow-inner" />
              </div>
              <div>
                <label className="text-xs c-text-2 font-semibold">Cuota</label>
                <input inputMode="decimal" value={cuotaMercadoCustom} onChange={(e) => setCuotaMercadoCustom(e.target.value)} placeholder="2.50" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1 shadow-inner" />
              </div>
            </div>
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <button onClick={crearMercadoCustom} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 shadow-sm">
              Publicar mercado en mesa
            </button>
          </div>
        </div>
      )}

      {resolviendoCustoms && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setResolviendoCustoms(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-sm space-y-3 border c-bd-1 c-maxh-80vh overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1 text-lg">Resolución Manual</div>
              <button onClick={() => setResolviendoCustoms(null)} className="c-text-2"><X size={18} /></button>
            </div>
            <p className="text-sm c-text-2 border-b c-bd-2 pb-2">
              Has metido opciones libres. Confirma qué ha pasado para liquidar las apuestas.
            </p>
            <div className="space-y-3">
               {partido.mercadosCustom.map(c => {
                  const idCustom = `${c.mercado}||${c.seleccion}`;
                  const acertado = resolviendoCustoms.respuestas[idCustom] || false;
                  return (
                      <div key={idCustom} className="p-3 rounded-lg c-bg-app border c-bd-1 flex items-center justify-between gap-3 shadow-sm">
                         <div className="text-sm font-semibold flex-1">
                            {c.mercado}: <span className="c-text-orange">{c.seleccion}</span>
                         </div>
                         <div className="flex border c-bd-2 rounded-lg overflow-hidden shrink-0 font-bold text-xs shadow-inner">
                            <button onClick={() => setResolviendoCustoms({ respuestas: { ...resolviendoCustoms.respuestas, [idCustom]: true } })} className={`px-3 py-1.5 transition-colors ${acertado ? "c-bg-green c-text-white" : "bg-white c-text-2 hover:bg-black/5"}`}>SÍ</button>
                            <button onClick={() => setResolviendoCustoms({ respuestas: { ...resolviendoCustoms.respuestas, [idCustom]: false } })} className={`px-3 py-1.5 transition-colors ${!acertado ? "c-bg-red c-text-white" : "bg-white c-text-2 hover:bg-black/5"}`}>NO</button>
                         </div>
                      </div>
                  );
               })}
            </div>
            <button onClick={() => procesarCierrePartido(resolviendoCustoms.respuestas)} className="w-full mt-3 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 shadow-sm">
              Confirmar y Liquidar Todo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}