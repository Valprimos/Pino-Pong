import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trophy, Crown, Plus, X, Check, Users, History, Swords, Ticket, RotateCcw, Loader2, Clock, Sun, Wind, Eye, EyeOff, Info, Trash2, Ban } from "lucide-react";

const RATING_INICIAL = 1000;
const K_FACTOR = 32;
const PENALIZACION_SOL = 60;
const FACTOR_VIENTO = 0.7;
const SD_PUNTOS = 4;

function expectedScore(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normCDF(x, mean, sd) {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function isParcial(a, b) {
  return (a === 7 && b === 0) || (a === 0 && b === 7) ||
         (a === 9 && b === 1) || (a === 1 && b === 9) ||
         (a === 11 && b === 2) || (a === 2 && b === 11);
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

function probDesdeTerminales(terminales, a, b) {
  const match = terminales.find(t => t.a === a && t.b === b);
  if (!match) return 0;
  return match.p * 0.85 + 0.005; 
}

function probPuntosIndividual(terminales, pts, isA) {
  let sum = 0;
  terminales.forEach(t => {
      if (isA && t.a === pts) sum += t.p;
      if (!isA && t.b === pts) sum += t.p;
  });
  if (sum === 0) return 0;
  return sum * 0.85 + 0.005; 
}

function cuota(p, margen) {
  const pSegura = Math.max(0.000001, p);
  const conMargen = (1 / pSegura) / (1 + margen);
  return Number(Math.max(1.01, conMargen).toFixed(2));
}

function calcularMercadosDesdeProbabilidad(pA, margen, historial, nombreA, nombreB) {
  const pB = 1 - pA;
  const closeness = 1 - Math.abs(2 * pA - 1);
  const perdedorEsperado = Math.round(19 * closeness);

  const ganador = { A: cuota(pA, margen), B: cuota(pB, margen), pA, pB };
  const terminales = calcularTerminales(pA);

  const perdedorEsperadoA = perdedorEsperadoJugador(historial, nombreA, perdedorEsperado);
  const perdedorEsperadoB = perdedorEsperadoJugador(historial, nombreB, perdedorEsperado);

  const handicaps = [3, 6, 10].map((k) => cuotaHandicap(pA, pB, perdedorEsperadoB, perdedorEsperadoA, margen, k));

  const esperadoA = pA * 21 + (1 - pA) * perdedorEsperadoA;
  const esperadoB = pB * 21 + (1 - pB) * perdedorEsperadoB;
  const puntosA = cuotaPuntosDefecto(pA, perdedorEsperadoA, esperadoA, margen);
  const puntosB = cuotaPuntosDefecto(pB, perdedorEsperadoB, esperadoB, margen);

  let probParciales = 0;
  let probAjustado = 0;
  terminales.forEach(t => {
      if (isParcial(t.a, t.b)) probParciales += t.p;
      else if (t.a >= 22 || t.b >= 22) probAjustado += t.p;
  });
  const probNormal = Math.max(0.01, 1 - probParciales - probAjustado);

  const comoTermina = {
    parciales: cuota(probParciales * 0.85 + 0.02, margen),
    normal: cuota(probNormal, margen),
    ajustado: cuota(probAjustado * 0.85 + 0.02, margen),
  };

  const resultadosExactos = [
    { marcador: `21-12`, p: probDesdeTerminales(terminales, 21, 12) },
    { marcador: `21-15`, p: probDesdeTerminales(terminales, 21, 15) },
    { marcador: `21-19`, p: probDesdeTerminales(terminales, 21, 19) },
    { marcador: `12-21`, p: probDesdeTerminales(terminales, 12, 21) },
    { marcador: `15-21`, p: probDesdeTerminales(terminales, 15, 21) },
    { marcador: `19-21`, p: probDesdeTerminales(terminales, 19, 21) },
  ].map(res => ({ marcador: res.marcador, cuota: cuota(res.p, margen) }));

  return { ganador, handicaps, puntosA, puntosB, esperadoA, esperadoB, comoTermina, resultadosExactos, terminales, perdedorEsperado, perdedorEsperadoA, perdedorEsperadoB };
}

function perdedorEsperadoJugador(historial, nombre, generico) {
  if (!nombre) return generico;
  const marcasAlPerder = [];
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    const esA = p.teamA[0] === nombre;
    const esB = p.teamB[0] === nombre;
    if (!esA && !esB) return;
    const suMarca = esA ? p.pa : p.pb;
    const suRivalMarca = esA ? p.pb : p.pa;
    if (suMarca > suRivalMarca) return;
    marcasAlPerder.push(suMarca);
  });
  if (marcasAlPerder.length === 0) return generico;
  const media = marcasAlPerder.reduce((s, x) => s + x, 0) / marcasAlPerder.length;
  const PESO = 4;
  return (media * marcasAlPerder.length + generico * PESO) / (marcasAlPerder.length + PESO);
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
  return (typeof v === "number" && v >= 1.01) ? v : null;
}

function cuotaHandicap(pA, pB, perdedorEsperadoSiPierdeB, perdedorEsperadoSiPierdeA, margen, k) {
  const probA = pA * normCDF(21 - k + 0.5, perdedorEsperadoSiPierdeB, SD_PUNTOS);
  const probB = pB * normCDF(21 - k + 0.5, perdedorEsperadoSiPierdeA, SD_PUNTOS);
  return { k, cuotaA: cuota(probA, margen), cuotaB: cuota(probB, margen) };
}

function probSuperaLinea(pWin, perdedorEsperado, linea) {
  if (linea < 21) {
    const pSiPierde = 1 - normCDF(linea, perdedorEsperado, SD_PUNTOS);
    return pWin * 1 + (1 - pWin) * pSiPierde;
  }
  const pSiGana = 1 - normCDF(linea, 21, SD_PUNTOS);
  const pSiPierde = 1 - normCDF(linea, perdedorEsperado, SD_PUNTOS);
  return pWin * pSiGana + (1 - pWin) * pSiPierde;
}

function cuotaPuntos(pWin, perdedorEsperado, margen, linea) {
  const probMas = Math.min(0.98, Math.max(0.02, probSuperaLinea(pWin, perdedorEsperado, linea)));
  return { linea, cuotaMas: cuota(probMas, margen), cuotaMenos: cuota(1 - probMas, margen) };
}
function cuotaPuntosDefecto(pWin, perdedorEsperado, esperado, margen) {
  const linea = Math.min(19.5, Math.max(4.5, Math.floor(esperado) + 0.5));
  return cuotaPuntos(pWin, perdedorEsperado, margen, linea);
}

function ladoConSentido(cuotaMas, cuotaMenos) {
  const CASI_SEGURO = 1.02;
  const masEsSeguro = cuotaMas <= CASI_SEGURO;
  const menosEsSeguro = cuotaMenos <= CASI_SEGURO;
  if (masEsSeguro && menosEsSeguro) return { mostrarMas: true, mostrarMenos: true };
  if (masEsSeguro) return { mostrarMas: false, mostrarMenos: true };
  if (menosEsSeguro) return { mostrarMas: true, mostrarMenos: false };
  return { mostrarMas: true, mostrarMenos: true };
}

function rangoPuntosSensato(historial, nombre) {
  const puntos = [];
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    if (p.teamA[0] === nombre) puntos.push(p.pa);
    if (p.teamB[0] === nombre) puntos.push(p.pb);
  });
  if (puntos.length < 3) return { min: 6, max: 17 };
  const minObs = Math.min(...puntos);
  const maxObs = Math.max(...puntos);
  let min = Math.max(3, minObs - 2);
  let max = Math.min(20, maxObs + 1);
  const ANCHURA_MINIMA = 11;
  if (max - min < ANCHURA_MINIMA) {
    const centro = (max + min) / 2;
    min = Math.max(3, Math.round(centro - ANCHURA_MINIMA / 2));
    max = Math.min(20, Math.round(centro + ANCHURA_MINIMA / 2));
  }
  return { min: Math.min(min, max - 2), max: Math.max(max, min + 2) };
}

function rangoHandicapSensato(pA, pB, perdedorEsperadoA, perdedorEsperadoB, margen) {
  let max = 3;
  for (let k = 3; k <= 19; k++) {
    const h = cuotaHandicap(pA, pB, perdedorEsperadoB, perdedorEsperadoA, margen, k);
    const cuotaFavorito = Math.min(h.cuotaA, h.cuotaB);
    if (cuotaFavorito >= 45) break;
    max = k;
  }
  return { min: 3, max: Math.max(6, max) };
}

function actualizarEloEquipo(ratingsA, ladoA, ratingsB, ladoB, ganoA, solLado, viento) {
  const avgA = ratingsA.reduce((s, r) => s + r, 0) / ratingsA.length;
  const avgB = ratingsB.reduce((s, r) => s + r, 0) / ratingsB.length;
  const { a: efA, b: efB } = ratingsEfectivas(avgA, avgB, ladoA, ladoB, solLado, viento);
  const pA = expectedScore(efA, efB);
  const pB = 1 - pA;
  const sA = ganoA ? 1 : 0, sB = ganoA ? 0 : 1;
  return { deltaA: K_FACTOR * (sA - pA), deltaB: K_FACTOR * (sB - pB) };
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

// MOTOR MATEMÁTICO: Evaluador lógico de contradicciones e implicaciones (SGP)
function sonContradictorias(a, b, partido) {
  if (!partido) return false;

  // Los mercados personalizados creados por el Boss escapan de la matemática estricta
  const isCustom = (m) => !["Ganador", "Resultado Exacto Partido", "Cómo termina"].includes(m) && !m.startsWith("Puntos Exactos") && !m.startsWith("Hándicap") && !m.startsWith("Puntos ");
  if (isCustom(a.mercado) || isCustom(b.mercado)) {
      if (a.mercado === b.mercado && a.seleccion !== b.seleccion) return true;
      return false;
  }

  // Simulamos TODOS los resultados posibles de pingpong para ver si chocan
  const allResultados = [];
  for(let pa=0; pa<=35; pa++){
    for(let pb=0; pb<=35; pb++){
       if(isValidScore(pa,pb)) allResultados.push({pa, pb});
    }
  }

  let vecesGanaA = 0, vecesGanaB = 0, vecesGananAmbas = 0;
  
  for (const r of allResultados) {
    const ctx = { ganador: r.pa > r.pb ? partido.a : partido.b, pa: r.pa, pb: r.pb, nombreA: partido.a, nombreB: partido.b };
    const w1 = evaluarPata(a.mercado, a.seleccion, ctx, {});
    const w2 = evaluarPata(b.mercado, b.seleccion, ctx, {});
    
    if (w1) vecesGanaA++;
    if (w2) vecesGanaB++;
    if (w1 && w2) vecesGananAmbas++;
  }

  // 1. Contradicción pura: Nunca se dan juntas en ningún universo posible.
  if (vecesGananAmbas === 0) return true; 

  // 2. Redundancia / Implicación: Matemática pura. Si un resultado ya obliga al otro, es redundante.
  if (vecesGananAmbas === vecesGanaA || vecesGananAmbas === vecesGanaB) return true;

  // Si pasa ambos filtros, significa que se solapan pero ninguna obliga a la otra. ¡Se pueden combinar!
  return false;
}

function actualizarTitulo(gm, pendiente, esGM, ganador) {
  if (!esGM) return { gm, pendiente };
  if (ganador === gm) return { gm, pendiente: null };
  if (pendiente === ganador) return { gm: ganador, pendiente: null };
  return { gm, pendiente: ganador };
}

function construirRegistrosPorJugador(historial) {
  const registros = {};
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    if (!p.ladoA || !p.ladoB) return;
    const [a] = p.teamA, [b] = p.teamB;
    const ratingA = p.ratingsAntes?.[a] ?? RATING_INICIAL;
    const ratingB = p.ratingsAntes?.[b] ?? RATING_INICIAL;
    const pEloA = expectedScore(ratingA, ratingB);
    const ganoA = p.pa > p.pb;
    if (!registros[a]) registros[a] = [];
    if (!registros[b]) registros[b] = [];
    registros[a].push({ lado: p.ladoA, gano: ganoA, pElo: pEloA, solLeMolesta: p.solLado === p.ladoA, viento: !!p.viento });
    registros[b].push({ lado: p.ladoB, gano: !ganoA, pElo: 1 - pEloA, solLeMolesta: p.solLado === p.ladoB, viento: !!p.viento });
  });
  return registros;
}

const TOPE_EFECTO_INDIVIDUAL = 0.12;
function efectoContextual(registrosJugador, filtro, pseudoN) {
  if (!registrosJugador) return { efecto: 0, n: 0, victorias: 0 };
  const subset = registrosJugador.filter(filtro);
  const n = subset.length;
  if (n === 0) return { efecto: 0, n: 0, victorias: 0 };
  const victorias = subset.filter((r) => r.gano).length;
  const mediaResiduo = subset.reduce((s, r) => s + ((r.gano ? 1 : 0) - r.pElo), 0) / n;
  const atenuado = mediaResiduo * (n / (n + pseudoN));
  const acotado = Math.max(-TOPE_EFECTO_INDIVIDUAL, Math.min(TOPE_EFECTO_INDIVIDUAL, atenuado));
  return { efecto: acotado, n, victorias };
}

const TOPE_EFECTO_TOTAL = 0.22;
function calcularEfectosJugador(registros, nombre, lado, solLado, viento) {
  const regs = registros[nombre];
  const efLado = efectoContextual(regs, (r) => r.lado === lado, 6);
  const efSol = efectoContextual(regs, (r) => r.solLeMolesta === (solLado === lado), 5);
  const efViento = efectoContextual(regs, (r) => r.viento === !!viento, 6);
  const sumaBruta = efLado.efecto + efSol.efecto + efViento.efecto;
  const total = Math.max(-TOPE_EFECTO_TOTAL, Math.min(TOPE_EFECTO_TOTAL, sumaBruta));
  return {
    total,
    detalle: { lado: efLado, sol: efSol, viento: efViento },
  };
}

function probabilidadYDetalle(historialPrevio, nombreA, nombreB, ratingA, ratingB, ladoA, ladoB, solLado, viento) {
  const registros = construirRegistrosPorJugador(historialPrevio);
  const registrosH2H = construirRegistrosH2H(historialPrevio);
  const pEloBase = expectedScore(ratingA, ratingB);
  const efA = calcularEfectosJugador(registros, nombreA, ladoA, solLado, viento);
  const efB = calcularEfectosJugador(registros, nombreB, ladoB, solLado, viento);
  const efH2H = efectoH2H(registrosH2H, nombreA, nombreB);
  const EPS = 0.03;
  const pAdjA = Math.min(1 - EPS, Math.max(EPS, pEloBase + efA.total));
  const pAdjB = Math.min(1 - EPS, Math.max(EPS, (1 - pEloBase) + efB.total));
  let pA = pAdjA / (pAdjA + pAdjB);
  pA = Math.min(1 - EPS, Math.max(EPS, pA + efH2H.efecto));
  return { pA, pB: 1 - pA, detalleA: efA.detalle, detalleB: efB.detalle, h2h: efH2H };
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
    if (!registros[a]) registros[a] = {};
    if (!registros[a][b]) registros[a][b] = [];
    registros[a][b].push({ gano: ganoA, pElo: pEloA });
    if (!registros[b]) registros[b] = {};
    if (!registros[b][a]) registros[b][a] = [];
    registros[b][a].push({ gano: !ganoA, pElo: 1 - pEloA });
  });
  return registros;
}

const TOPE_H2H = 0.3;
function efectoH2H(registrosH2H, nombreA, nombreB) {
  const regs = registrosH2H[nombreA]?.[nombreB];
  if (!regs || regs.length === 0) return { efecto: 0, n: 0, victorias: 0 };
  const n = regs.length;
  const victorias = regs.filter((r) => r.gano).length;
  const mediaResiduo = regs.reduce((s, r) => s + ((r.gano ? 1 : 0) - r.pElo), 0) / n;
  const atenuado = mediaResiduo * (n / (n + 2.5));
  const acotado = Math.max(-TOPE_H2H, Math.min(TOPE_H2H, atenuado));
  return { efecto: acotado, n, victorias };
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
  const registros = construirRegistrosPorJugador(historial);
  const regs = registros[nombre] || [];
  const contarVD = (arr) => ({ n: arr.length, victorias: arr.filter((r) => r.gano).length });

  const registrosH2H = construirRegistrosH2H(historial);
  const h2h = {};
  Object.entries(registrosH2H[nombre] || {}).forEach(([rival, list]) => {
    h2h[rival] = { n: list.length, victorias: list.filter((r) => r.gano).length };
  });

  const partidos = historial.filter((p) => p.teamA && p.teamB && (p.teamA.includes(nombre) || p.teamB.includes(nombre)));

  return {
    racha: calcularRacha(historial, nombre),
    lado: {
      Canasta: contarVD(regs.filter((r) => r.lado === "Canasta")),
      Columpios: contarVD(regs.filter((r) => r.lado === "Columpios")),
    },
    sol: contarVD(regs.filter((r) => r.solLeMolesta)),
    viento: contarVD(regs.filter((r) => r.viento)),
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

const STORAGE_KEY = "casa-pingpong-estado-v1";

const ESTADO_DEFECTO = {
  jugadores: {}, gm: null, pendiente: null, margen: 0.08,
  bettors: {}, partidoAbierto: null, historial: [], vetados: [],
};

async function cargarEstado() {
  try {
    const res = localStorage.getItem(STORAGE_KEY);
    if (res) return JSON.parse(res);
  } catch (e) {}
  return null;
}
async function guardarEstado(estado) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(estado)); }
  catch (e) { console.error("Error guardando estado", e); }
}

const HISTORIAL_REAL = [
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 16, pb: 21, esGM: true },
  { teamA: ["Nicolás"], teamB: ["Javier"], pa: 5, pb: 21, esGM: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: false },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 13, esGM: false },
  { teamA: ["Nicolás"], teamB: ["Carlos (tío)"], pa: 21, pb: 15, esGM: false },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 12, esGM: true },
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
    if (equipoA.length === 1 && equipoB.length === 1) {
      const { pA } = probabilidadYDetalle(
        historial, equipoA[0], equipoB[0],
        jugadores[equipoA[0]], jugadores[equipoB[0]],
        m.ladoA ?? null, m.ladoB ?? null, m.solLado ?? null, !!m.viento
      );
      const sA = ganoA ? 1 : 0, sB = ganoA ? 0 : 1;
      deltaA = K_FACTOR * (sA - pA);
      deltaB = K_FACTOR * (sB - (1 - pA));
    } else {
      const r = actualizarEloEquipo(
        equipoA.map((n) => jugadores[n]), m.ladoA ?? null,
        equipoB.map((n) => jugadores[n]), m.ladoB ?? null,
        ganoA, m.solLado ?? null, !!m.viento
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
      className="inline-flex items-center justify-center rounded-full font-bold c-text-1 shrink-0 ring-2 ring-black/20"
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
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function BotonCuota({ etiqueta, valor, valorBase, boosteado, locked, onClick, disabled, sub, activo }) {
  if (locked) {
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
      disabled={disabled}
      className={`relative flex-1 c-minw-84 rounded-lg px-2 py-2.5 text-center transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:active:scale-100 border-2 ${
        boosteado
          ? `boost-cuota border-transparent ${activo ? "ring-4 ring-white scale-110" : ""}`
          : activo
          ? "c-bg-orange c-bd-orange c-shadow-glow-orange scale-105"
          : "c-bg-app c-bd-1 hover:c-bd-orange-60"
      }`}
    >
      {boosteado && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 c-bg-mesa text-white text-[8px] font-extrabold px-2 py-0.5 rounded-full shadow whitespace-nowrap">
          🔥 SUPERCUOTA
        </span>
      )}
      {activo && (
        <span className="absolute -bottom-2 -right-2 rounded-full p-1 shadow-md bg-white">
          <Check size={12} strokeWidth={4} className={boosteado ? "c-text-mesa" : "c-text-orange-lg"} />
        </span>
      )}
      <div className={`text-[10.5px] leading-tight font-semibold truncate ${boosteado ? "text-white" : activo ? "c-text-dark-on-accent" : "c-text-2"}`}>{etiqueta}</div>
      {sub && <div className={`text-[9px] ${boosteado ? "text-white/80" : activo ? "c-text-dark-on-accent-70" : "c-text-2"}`}>{sub}</div>}
      {boosteado && typeof valorBase === "number" && (
        <div className="text-[10px] line-through text-white/70 font-semibold -mb-0.5">{valorBase.toFixed(2)}</div>
      )}
      <div className="font-extrabold text-base mt-0.5" style={{ fontVariantNumeric: "tabular-nums", color: boosteado ? "#FFFFFF" : activo ? "#1A0D05" : "#C2410C" }}>
        {valor.toFixed(2)}
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

function AnalisisColumna({ nombre, detalle }) {
  const filas = [
    { label: "En este campo", d: detalle.lado },
    { label: "Con este sol", d: detalle.sol },
    { label: "Con este viento", d: detalle.viento },
  ];
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-xs font-bold c-text-1 truncate">{nombre}</div>
      {filas.map((f, i) => (
        <div key={i} className="text-[10.5px] flex justify-between gap-2">
          <span className="c-text-2 truncate">{f.label}</span>
          {f.d.n > 0 ? (
            <span className="font-mono c-text-3 shrink-0">{f.d.victorias}V-{f.d.n - f.d.victorias}D ({Math.round((100 * f.d.victorias) / f.d.n)}%)</span>
          ) : (
            <span className="c-text-4 shrink-0">sin datos</span>
          )}
        </div>
      ))}
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

function traducirPata(mercado, seleccion) {
  if (mercado === "Ganador") return `${seleccion} gana el partido.`;
  if (mercado === "Resultado Exacto Partido") return `El partido termina exactamente ${seleccion}.`;
  if (mercado.startsWith("Hándicap")) {
      const k = mercado.match(/(\d+)/)[1];
      return `${seleccion} gana con una ventaja de ${k} o más puntos.`;
  }
  if (mercado.startsWith("Puntos Exactos")) {
      const j = mercado.replace("Puntos Exactos ", "");
      return `${j} anota exactamente ${seleccion} puntos en todo el partido.`;
  }
  if (mercado.startsWith("Puntos")) {
      const m = mercado.match(/^Puntos (.+) ([\d.]+)$/);
      if(!m) return `${mercado}: ${seleccion}`;
      const j = m[1], linea = Number(m[2]);
      if (seleccion === "Más") return `${j} anota ${Math.ceil(linea)} puntos o más.`;
      return `${j} se queda en ${Math.floor(linea)} puntos o menos.`;
  }
  if (mercado === "Cómo termina") {
      if (seleccion === "parciales") return `El perdedor se queda en 2, 1 o 0 puntos (7-0, 9-1, 11-2...).`;
      if (seleccion === "ajustado") return `El partido se va al deuce (22-20, 23-21, etc.).`;
      if (seleccion === "normal") return `Termina a 21 normal, el perdedor hace entre 3 y 19 puntos.`;
  }
  return `${mercado}: ${seleccion}`;
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
                   <div className="text-xs c-text-2 italic flex items-start gap-1">
                     <Info size={14} className="shrink-0 mt-0.5" />
                     <span>"{traducirPata(p.mercado, p.seleccion)}"</span>
                   </div>
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

function FilaRecord({ etiqueta, d }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="c-text-2">{etiqueta}</span>
      {d.n > 0 ? (
        <span className="font-mono font-bold c-text-1">{d.victorias}V-{d.n - d.victorias}D <span className="c-text-2 font-normal">({Math.round((100 * d.victorias) / d.n)}%)</span></span>
      ) : (
        <span className="c-text-4">sin datos</span>
      )}
    </div>
  );
}

function ModalPerfil({ nombre, perfil, rating, onCerrar }) {
  const rivales = Object.entries(perfil.h2h).sort((a, b) => b[1].n - a[1].n);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full max-w-md space-y-3 border c-bd-1 c-maxh-80vh overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar name={nombre} size={32} />
            <div>
              <div className="font-bold c-text-1" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{nombre.toUpperCase()}</div>
              <div className="text-xs c-text-2">Rating {rating.toFixed(2)}</div>
            </div>
          </div>
          <button onClick={onCerrar} className="c-text-2"><X size={20} /></button>
        </div>

        {Math.abs(perfil.racha) >= 2 && (
          <Chip tone={perfil.racha > 0 ? "gold" : "info"}>
            {perfil.racha > 0 ? "🔥" : "❄️"} {Math.abs(perfil.racha)} {perfil.racha > 0 ? "victorias" : "derrotas"} seguidas
          </Chip>
        )}

        <div className="space-y-1.5 rounded-lg c-bg-app p-3 border c-bd-2">
          <div className="text-[10px] font-bold uppercase tracking-wide c-text-2">Por campo</div>
          <FilaRecord etiqueta="En Canasta" d={perfil.lado.Canasta} />
          <FilaRecord etiqueta="En Columpios" d={perfil.lado.Columpios} />
        </div>

        <div className="space-y-1.5 rounded-lg c-bg-app p-3 border c-bd-2">
          <div className="text-[10px] font-bold uppercase tracking-wide c-text-2">Con condiciones en contra</div>
          <FilaRecord etiqueta="Con sol molestando" d={perfil.sol} />
          <FilaRecord etiqueta="Con viento" d={perfil.viento} />
        </div>

        <div className="space-y-1.5 rounded-lg c-bg-app p-3 border c-bd-2">
          <div className="text-[10px] font-bold uppercase tracking-wide c-text-2">Cara a cara</div>
          {rivales.length === 0 ? (
            <p className="text-sm c-text-2">Todavía no se ha cruzado con nadie.</p>
          ) : (
            rivales.map(([rival, d]) => <FilaRecord key={rival} etiqueta={`vs ${rival}`} d={d} />)
          )}
        </div>

        {perfil.ultimos.length > 0 && (
          <div className="space-y-1.5 rounded-lg c-bg-app p-3 border c-bd-2">
            <div className="text-[10px] font-bold uppercase tracking-wide c-text-2">Últimos partidos</div>
            {perfil.ultimos.map((p) => (
              <div key={p.id} className="text-xs flex justify-between c-text-2">
                <span>{p.aLabel} {p.pa} – {p.pb} {p.bLabel}</span>
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

  const prevSlipLen = useRef(0);

  useEffect(() => {
    (async () => {
      const cargado = await cargarEstado();
      setEstado(cargado || ESTADO_DEFECTO);
      setCargando(false);
    })();
  }, []);

  useEffect(() => {
    if (!estado?.partidoAbierto) return;
    const partidoActual = estado.partidoAbierto;
    
    const analisisTemp = probabilidadYDetalle(estado.historial, partidoActual.a, partidoActual.b, ratingDe(partidoActual.a), ratingDe(partidoActual.b), partidoActual.ladoA, partidoActual.ladoB, partidoActual.solLado, partidoActual.viento);
    const mercadosTemp = calcularMercadosDesdeProbabilidad(analisisTemp.pA, estado.margen, estado.historial, partidoActual.a, partidoActual.b);
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
  }, [estado?.partidoAbierto?.boosts, estado?.margen]);

  useEffect(() => {
    if (slip.length > prevSlipLen.current) {
      setFabPop(true);
      const t = setTimeout(() => setFabPop(false), 260);
      prevSlipLen.current = slip.length;
      return () => clearTimeout(t);
    }
    prevSlipLen.current = slip.length;
  }, [slip.length]);

  const persistir = useCallback(async (nuevo) => {
    setEstado(nuevo);
    await guardarEstado(nuevo);
  }, []);

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
    persistir({ ...estado, jugadores: { ...estado.jugadores, [nombre]: RATING_INICIAL } });
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
  }

  function exportarHistorial() {
    const csv = historialACSV(estado.historial);
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
    const rProb = probabilidadYDetalle(estado.historial, selA, selB, ratingDe(selA), ratingDe(selB), ladoAInput, ladoBAuto, solLadoInput, vientoInput);
    const perdGenerico = Math.round(19 * (1 - Math.abs(2 * rProb.pA - 1)));
    const perdEsA = perdedorEsperadoJugador(estado.historial, selA, perdGenerico);
    const perdEsB = perdedorEsperadoJugador(estado.historial, selB, perdGenerico);
    const rH = rangoHandicapSensato(rProb.pA, rProb.pB, perdEsA, perdEsB, estado.margen);
    const rA = rangoPuntosSensato(estado.historial, selA);
    const rB = rangoPuntosSensato(estado.historial, selB);
    setHandicapK(Math.round((rH.min + rH.max) / 2));
    setLineaA(Math.round((rA.min + rA.max) / 2));
    setLineaB(Math.round((rB.min + rB.max) / 2));
    persistir({ ...estado, partidoAbierto: nuevo });
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
    
    if (valorLimpio && (!val || val < 1.01)) {
      setError("La cuota debe ser 1.01 o más.");
      return;
    }
    const nuevosBoosts = { ...(partido.boosts || {}) };
    const clave = claveBoost(mercado, seleccion);
    
    if (val) nuevosBoosts[clave] = Number(val.toFixed(2));
    else delete nuevosBoosts[clave];
    
    persistir({ ...estado, partidoAbierto: { ...partido, boosts: nuevosBoosts } });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
    setError("");
  }

  function bloquearCuota() {
    const { mercado, seleccion } = editarCuotaObjetivo;
    const nuevosBoosts = { ...(partido.boosts || {}) };
    nuevosBoosts[claveBoost(mercado, seleccion)] = "LOCKED";
    persistir({ ...estado, partidoAbierto: { ...partido, boosts: nuevosBoosts } });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
  }

  function quitarCuotaEditada() {
    if (!editarCuotaObjetivo) return;
    const nuevosBoosts = { ...(partido.boosts || {}) };
    delete nuevosBoosts[claveBoost(editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion)];
    persistir({ ...estado, partidoAbierto: { ...partido, boosts: nuevosBoosts } });
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
      setError(`"${seleccion}" (en ${mercado}) entra en conflicto lógico con "${conflicto.seleccion}" (en ${conflicto.mercado}). Son apuestas contradictorias o redundantes.`);
      return;
    }

    setError("");
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
    const nombre = bettorSlip.trim();
    if (!nombre) { setError("Pon el nombre de quién apuesta."); return; }
    if (estado.vetados?.includes(nombre)) { setError(`${nombre} está vetado por la casa y no puede apostar.`); return; }
    
    const hasLocked = slip.some(s => boostDe(partido, s.mercado, s.seleccion) === "LOCKED");
    if (hasLocked) { setError("Una de las cuotas de tu cesta acaba de ser bloqueada por la casa. Quítala para continuar."); return; }

    const saldoActual = estado.bettors[nombre] ?? 500;
    const rachaApostante = calcularRachaApuestas(estado.historial, nombre);
    const bonus = bonusPorRachaApostante(rachaApostante);

    if (modoSlip === "combinada" && slip.length >= 2) {
      const stakeVal = Number(stakeCombinada.replace(',', '.')) || 0;
      if (stakeVal <= 0) { setError("Pon una cantidad de fichas válida."); return; }
      if (saldoActual < stakeVal) { setError(`${nombre} solo tiene ${saldoActual.toFixed(2)} fichas.`); return; }
      const cuotaTotal = Math.max(1.01, Number((slip.reduce((acc, s) => acc * s.cuota, 1) * bonus).toFixed(2)));
      setError("");
      const apuesta = {
        id: Date.now(), bettor: nombre, tipo: "combinada",
        patas: slip.map((s) => ({ mercado: s.mercado, seleccion: s.seleccion, cuota: Number(s.cuota.toFixed(2)), boosteada: typeof boostDe(partido, s.mercado, s.seleccion) === "number" && boostDe(partido, s.mercado, s.seleccion) > s.cuota })),
        cuota: cuotaTotal, stake: stakeVal, estado: "pendiente", bonusRacha: bonus > 1 ? bonus : null,
      };
      const nuevosBettors = { ...estado.bettors, [nombre]: Number((saldoActual - stakeVal).toFixed(2)) };
      const nuevoPartido = { ...partido, apuestas: [...partido.apuestas, apuesta] };
      persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido });
      setTicketVisible({ bettor: nombre, apuestas: [apuesta] });
      if (slip.some((s) => typeof boostDe(partido, s.mercado, s.seleccion) === "number" && boostDe(partido, s.mercado, s.seleccion) > s.cuota)) {
        setCelebracion({ nombre, tipo: "supercuota" });
      }
      setSlip([]); setSlipOpen(false); setBettorSlip(""); setStakeCombinada("50");
      return;
    }

    const totalStake = slip.reduce((s, x) => s + x.stake, 0);
    if (slip.some((s) => !s.stake || s.stake <= 0)) { setError("Todas las apuestas necesitan una cantidad de fichas."); return; }
    if (saldoActual < totalStake) { setError(`${nombre} solo tiene ${saldoActual.toFixed(2)} fichas y esta cesta suma ${totalStake.toFixed(2)}.`); return; }
    setError("");
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

    if (!mNombre || !mSel || isNaN(mCuotaVal) || mCuotaVal < 1.01) {
      setError("Rellena todos los campos con valores válidos (cuota debe ser 1.01 o más).");
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
    const listaActual = partido.mercadosCustom || [];
    const partidoActualizado = { ...partido, mercadosCustom: listaActual.filter(item => item.id !== idCustom) };
    persistir({ ...estado, partidoAbierto: partidoActualizado });
  }

  function toggleVeto(nombre) {
    const vetados = estado.vetados || [];
    if (vetados.includes(nombre)) persistir({...estado, vetados: vetados.filter(n => n !== nombre)});
    else persistir({...estado, vetados: [...vetados, nombre]});
  }

  function anularApuesta(idApuesta) {
    if (!window.confirm("¿Seguro que quieres anular esta apuesta y devolver las fichas?")) return;
    const ap = partido.apuestas.find(a => a.id === idApuesta);
    if (!ap) return;
    const nuevosBettors = {...estado.bettors};
    nuevosBettors[ap.bettor] = Number(((nuevosBettors[ap.bettor] || 0) + ap.stake).toFixed(2));
    const nuevoPartido = {...partido, apuestas: partido.apuestas.filter(a => a.id !== idApuesta)};
    persistir({...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido});
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
    const { pA: pAjustadaA } = probabilidadYDetalle(estado.historial, partido.a, partido.b, ratingA0, ratingB0, partido.ladoA, partido.ladoB, partido.solLado, partido.viento);
    const pBajustadaB = 1 - pAjustadaA;
    const sA_ = ganoA ? 1 : 0, sB_ = ganoA ? 0 : 1;
    const deltaA = K_FACTOR * (sA_ - pAjustadaA), deltaB = K_FACTOR * (sB_ - pBajustadaB);
    const nuevoA = ratingA0 + deltaA, nuevoB = ratingB0 + deltaB;
    const { gm, pendiente } = actualizarTitulo(estado.gm, estado.pendiente, partido.esGM, ganador);

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
    const rachaRota = calcularRacha(estado.historial, perdedor) >= 3;
    partidoCerrado.titular = generarTitular(partidoCerrado, coronacion, rachaRota);

    if (gm && gm !== estado.gm) setCelebracion({ nombre: gm, tipo: "gm" });

    persistir({
      ...estado,
      jugadores: { ...estado.jugadores, [partido.a]: nuevoA, [partido.b]: nuevoB },
      gm, pendiente, bettors: nuevosBettors, partidoAbierto: null,
      historial: [partidoCerrado, ...estado.historial],
    });
    setMarcador({ a: "", b: "" });
    setResolviendoCustoms(null);
  }

  function eliminarPartidoHistorial(idPartido) {
    const partidoABorrar = estado.historial.find(p => p.id === idPartido);
    if (!partidoABorrar) return;

    if (window.confirm("¿Seguro que quieres borrar este partido del historial? Se devolverán las fichas y se restaurará el ELO.")) {
      const nuevoHistorial = estado.historial.filter((p) => p.id !== idPartido);
      let nuevosJugadores = { ...estado.jugadores };
      let nuevosBettors = { ...estado.bettors };

      if (estado.historial[0].id === idPartido) {
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

  const analisis = partido
    ? probabilidadYDetalle(estado.historial, partido.a, partido.b, ratingDe(partido.a), ratingDe(partido.b), partido.ladoA, partido.ladoB, partido.solLado, partido.viento)
    : null;
  const mercados = partido && analisis ? calcularMercadosDesdeProbabilidad(analisis.pA, estado.margen, estado.historial, partido.a, partido.b) : null;
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
  const rachaA = partido ? calcularRacha(estado.historial, partido.a) : 0;
  const rachaB = partido ? calcularRacha(estado.historial, partido.b) : 0;
  const rangoH = partido && mercados ? rangoHandicapSensato(mercados.ganador.pA, mercados.ganador.pB, mercados.perdedorEsperadoA, mercados.perdedorEsperadoB, estado.margen) : { min: 3, max: 10 };
  const rangoA = partido ? rangoPuntosSensato(estado.historial, partido.a) : { min: 6, max: 17 };
  const rangoB = partido ? rangoPuntosSensato(estado.historial, partido.b) : { min: 6, max: 17 };
  const handicapKClamp = Math.min(rangoH.max, Math.max(rangoH.min, handicapK));
  const lineaAClamp = Math.min(rangoA.max, Math.max(rangoA.min, lineaA));
  const lineaBClamp = Math.min(rangoB.max, Math.max(rangoB.min, lineaB));
  const handicapVivo = mercados ? cuotaHandicap(mercados.ganador.pA, mercados.ganador.pB, mercados.perdedorEsperadoB, mercados.perdedorEsperadoA, estado.margen, handicapKClamp) : null;
  const puntosAVivo = mercados ? cuotaPuntos(mercados.ganador.pA, mercados.perdedorEsperadoA, estado.margen, lineaAClamp) : null;
  const puntosBVivo = mercados ? cuotaPuntos(mercados.ganador.pB, mercados.perdedorEsperadoB, estado.margen, lineaBClamp) : null;
  const variacionA0 = puntosAVivo ? ladoConSentido(puntosAVivo.cuotaMas, puntosAVivo.cuotaMenos) : { mostrarMas: true, mostrarMenos: true };
  const variacionB0 = puntosBVivo ? ladoConSentido(puntosBVivo.cuotaMas, puntosBVivo.cuotaMenos) : { mostrarMas: true, mostrarMenos: true };
  const handicapLados0 = handicapVivo ? ladoConSentido(handicapVivo.cuotaA, handicapVivo.cuotaB) : { mostrarMas: true, mostrarMenos: true };

  const variacionA = modoEditarCuotas && !modoEspectador ? { mostrarMas: true, mostrarMenos: true } : variacionA0;
  const variacionB = modoEditarCuotas && !modoEspectador ? { mostrarMas: true, mostrarMenos: true } : variacionB0;
  const handicapLados = modoEditarCuotas && !modoEspectador ? { mostrarMas: true, mostrarMenos: true } : handicapLados0;
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
  const estadisticasApostantes = calcularEstadisticasApostantes(estado.historial, estado.bettors);
  const rankingEstilo = calcularRankingEstilo(estado.historial);

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
        .c-text-blue { color: #1D4ED8 !important; }

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
          <div className="text-sm c-bg-red-soft border c-bd-red-40 c-text-red2 rounded-lg px-3 py-2 flex justify-between">
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
            {nombresJugadores.length === 0 && estado.historial.length === 0 && (
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
                {!modoEspectador && <button onClick={cancelarPartido} className="c-text-2 hover:c-text-1 text-xs underline">cancelar partido (devuelve puntos)</button>}
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

            {!modoEspectador && analisis && (analisis.detalleA.lado.n > 0 || analisis.detalleA.sol.n > 0 || analisis.detalleA.viento.n > 0 || analisis.detalleB.lado.n > 0 || analisis.detalleB.sol.n > 0 || analisis.detalleB.viento.n > 0) && (
              <Panel icon={Swords} titulo="Análisis de la cuota">
                <div className="grid grid-cols-2 gap-3">
                  <AnalisisColumna nombre={partido.a} detalle={analisis.detalleA} />
                  <AnalisisColumna nombre={partido.b} detalle={analisis.detalleB} />
                </div>
                <div className="text-[10px] c-text-4 pt-1">Con pocos partidos el efecto se atenúa automáticamente.</div>
              </Panel>
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
                <BotonCuota etiqueta={partido.a} valor={bGanadorA.valor} valorBase={bGanadorA.base} boosteado={bGanadorA.boosteado} locked={bGanadorA.locked} activo={!!estaEnSlip("Ganador", partido.a)} onClick={() => manejarClicCuota("Ganador", partido.a, ganadorConDinero.A, partido.a)} />
                <BotonCuota etiqueta={partido.b} valor={bGanadorB.valor} valorBase={bGanadorB.base} boosteado={bGanadorB.boosteado} locked={bGanadorB.locked} activo={!!estaEnSlip("Ganador", partido.b)} onClick={() => manejarClicCuota("Ganador", partido.b, ganadorConDinero.B, partido.b)} />
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
                     <BotonCuota 
                       etiqueta={`${partido.a} hace`} sub={`${ptsCreatorA} pts exactos`} 
                       valor={bPtsA?.valor ?? cuotaPtsA} valorBase={cuotaPtsA} boosteado={bPtsA?.boosteado} locked={bPtsA?.locked}
                       activo={!!estaEnSlip(`Puntos Exactos ${partido.a}`, String(pAInt))} 
                       onClick={() => manejarClicCuota(`Puntos Exactos ${partido.a}`, String(pAInt), cuotaPtsA, `${partido.a} hace ${pAInt} pts`)} 
                     />
                  )}
                  {cuotaPtsB !== null && ptsCreatorB !== "" && (
                     <BotonCuota 
                       etiqueta={`${partido.b} hace`} sub={`${ptsCreatorB} pts exactos`} 
                       valor={bPtsB?.valor ?? cuotaPtsB} valorBase={cuotaPtsB} boosteado={bPtsB?.boosteado} locked={bPtsB?.locked}
                       activo={!!estaEnSlip(`Puntos Exactos ${partido.b}`, String(pBInt))} 
                       onClick={() => manejarClicCuota(`Puntos Exactos ${partido.b}`, String(pBInt), cuotaPtsB, `${partido.b} hace ${pBInt} pts`)} 
                     />
                  )}
                </div>
                
                {isValScore && cuotaPartido !== null && (
                   <div className="pt-1 border-t c-bd-1 mt-1">
                     <BotonCuota 
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
                          <BotonCuota 
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
                    {handicapLados.mostrarMas && <BotonCuota etiqueta={`Gana ${partido.a}`} valor={bHandicapA.valor} valorBase={bHandicapA.base} boosteado={bHandicapA.boosteado} locked={bHandicapA.locked} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.a)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.a, handicapVivo.cuotaA, `Gana ${partido.a}`)} />}
                    {handicapLados.mostrarMenos && <BotonCuota etiqueta={`Gana ${partido.b}`} valor={bHandicapB.valor} valorBase={bHandicapB.base} boosteado={bHandicapB.boosteado} locked={bHandicapB.locked} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.b)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.b, handicapVivo.cuotaB, `Gana ${partido.b}`)} />}
                  </div>
                )}
              </div>
            </Panel>

            <Panel icon={Ticket} titulo="Más / menos puntos">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={rangoA.min} max={rangoA.max} step={1} value={lineaAClamp}
                      onChange={(e) => setLineaA(Number(e.target.value))}
                      style={{ accentColor: "#FF5A1F" }} className="flex-1" />
                    <span className="text-sm font-bold c-text-1 w-24 text-right">{partido.a}: {lineaAClamp}</span>
                  </div>
                  {puntosAVivo && (variacionA.mostrarMas || variacionA.mostrarMenos) && (
                    <div className="flex gap-2 mt-1">
                      {variacionA.mostrarMas && <BotonCuota etiqueta="Más de" sub={`${lineaAClamp}`} valor={bPuntosAMas.valor} valorBase={bPuntosAMas.base} boosteado={bPuntosAMas.boosteado} locked={bPuntosAMas.locked} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}`, "Más", puntosAVivo.cuotaMas, `${partido.a} más de ${lineaAClamp}`)} />}
                      {variacionA.mostrarMenos && <BotonCuota etiqueta="Menos de" sub={`${lineaAClamp}`} valor={bPuntosAMenos.valor} valorBase={bPuntosAMenos.base} boosteado={bPuntosAMenos.boosteado} locked={bPuntosAMenos.locked} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}`, "Menos", puntosAVivo.cuotaMenos, `${partido.a} menos de ${lineaAClamp}`)} />}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={rangoB.min} max={rangoB.max} step={1} value={lineaBClamp}
                      onChange={(e) => setLineaB(Number(e.target.value))}
                      style={{ accentColor: "#FF5A1F" }} className="flex-1" />
                    <span className="text-sm font-bold c-text-1 w-24 text-right">{partido.b}: {lineaBClamp}</span>
                  </div>
                  {puntosBVivo && (variacionB.mostrarMas || variacionB.mostrarMenos) && (
                    <div className="flex gap-2 mt-1">
                      {variacionB.mostrarMas && <BotonCuota etiqueta="Más de" sub={`${lineaBClamp}`} valor={bPuntosBMas.valor} valorBase={bPuntosBMas.base} boosteado={bPuntosBMas.boosteado} locked={bPuntosBMas.locked} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}`, "Más", puntosBVivo.cuotaMas, `${partido.b} más de ${lineaBClamp}`)} />}
                      {variacionB.mostrarMenos && <BotonCuota etiqueta="Menos de" sub={`${lineaBClamp}`} valor={bPuntosBMenos.valor} valorBase={bPuntosBMenos.base} boosteado={bPuntosBMenos.boosteado} locked={bPuntosBMenos.locked} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}`, "Menos", puntosBVivo.cuotaMenos, `${partido.b} menos de ${lineaBClamp}`)} />}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <Panel icon={Trophy} titulo="Cómo termina el partido">
              <div className="flex gap-2">
                <BotonCuota etiqueta="Parciales (rival ≤2)" valor={bComoParciales.valor} valorBase={bComoParciales.base} boosteado={bComoParciales.boosteado} locked={bComoParciales.locked} activo={!!estaEnSlip("Cómo termina", "parciales")} onClick={() => manejarClicCuota("Cómo termina", "parciales", mercados.comoTermina.parciales, "Parciales")} />
                <BotonCuota etiqueta="Normal (3-19)" valor={bComoNormal.valor} valorBase={bComoNormal.base} boosteado={bComoNormal.boosteado} locked={bComoNormal.locked} activo={!!estaEnSlip("Cómo termina", "normal")} onClick={() => manejarClicCuota("Cómo termina", "normal", mercados.comoTermina.normal, "Normal")} />
                <BotonCuota etiqueta="Ajustado (deuce)" valor={bComoAjustado.valor} valorBase={bComoAjustado.base} boosteado={bComoAjustado.boosteado} locked={bComoAjustado.locked} activo={!!estaEnSlip("Cómo termina", "ajustado")} onClick={() => manejarClicCuota("Cómo termina", "ajustado", mercados.comoTermina.ajustado, "Ajustado")} />
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
                           <button onClick={() => anularApuesta(ap.id)} className="c-text-red2 hover:c-bg-red-soft p-1 rounded transition-colors" title="Anular apuesta">
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
                  <input inputMode="numeric" placeholder={partido.a} value={marcador.a} onChange={(e) => setMarcador({ ...marcador, a: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1" />
                  <span className="c-text-2">–</span>
                  <input inputMode="numeric" placeholder={partido.b} value={marcador.b} onChange={(e) => setMarcador({ ...marcador, b: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1" />
                </div>
                <button onClick={iniciarCierrePartido} className="w-full mt-2 rounded-lg c-bg-green c-text-green-dark font-bold py-2.5 active:scale-95 transition-transform">
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
                  <input value={nuevoJugador} onChange={(e) => setNuevoJugador(e.target.value)} placeholder="Nombre" className="flex-1 rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1" />
                  <button onClick={agregarJugador} className="rounded-lg c-bg-orange c-text-dark-on-accent px-4 font-bold active:scale-95 transition-transform">Añadir</button>
                </div>
              </Panel>
            )}
            <Panel icon={Users} titulo="Ranking actual">
              {nombresJugadores.length === 0 ? (
                <p className="text-sm c-text-2">Todavía no hay jugadores.</p>
              ) : (
                <div className="space-y-1">
                  {nombresJugadores.slice().sort((a, b) => estado.jugadores[b] - estado.jugadores[a]).map((n, i) => {
                    const racha = calcularRacha(estado.historial, n);
                    return (
                    <button key={n} onClick={() => setPerfilAbierto(n)} className="w-full flex items-center justify-between rounded-lg c-bg-app px-3 py-2 border c-bd-2 text-left active:scale-[0.98] transition-transform">
                      <div className="flex items-center gap-2 text-sm font-medium c-text-1 min-w-0">
                        <span className="c-text-2 text-xs w-4 shrink-0">{i + 1}</span>
                        <Avatar name={n} size={24} />
                        <span className="truncate">{n}</span>
                        {estado.gm === n && <Crown size={14} className="c-text-gold shrink-0" />}
                        {estado.pendiente === n && <Chip tone="live">retador</Chip>}
                        {Math.abs(racha) >= 3 && <span className="shrink-0">{racha > 0 ? "🔥" : "❄️"}</span>}
                        {!estado.gm && !modoEspectador && <span onClick={(e) => { e.stopPropagation(); fijarGMInicial(n); }} className="text-[10px] underline c-text-orange shrink-0">hacer GM</span>}
                      </div>
                      <span className="font-mono text-sm c-text-orange font-bold shrink-0">{estado.jugadores[n].toFixed(2)}</span>
                    </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel icon={Ticket} titulo="🎲 Mejor tahúr del verano">
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
                          <div key={n} className="flex flex-col items-center gap-1 w-16 relative">
                            {vetado && <div className="absolute top-0 right-0 c-text-red2"><Ban size={14} /></div>}
                            <Avatar name={n} size={26} />
                            <div className="text-[10px] c-text-1 font-semibold truncate w-full text-center">{n}</div>
                            <div className={`w-full ${alturaOrden} rounded-t-md c-grad-podio border c-bd-2b flex flex-col items-center justify-end pb-1`}>
                              <span className="text-lg">{medalla}</span>
                              <span className="text-[10px] font-mono font-bold c-text-orange">{saldo.toFixed(0)}</span>
                            </div>
                            {est.total > 0 && <div className="text-[9px] c-text-2">{est.aciertos}/{est.total} ({Math.round(100 * est.aciertos / est.total)}%)</div>}
                            {!modoEspectador && (
                               <button onClick={() => toggleVeto(n)} className="text-[8px] uppercase underline mt-1 c-text-3">{vetado ? "Quitar Veto" : "Vetar"}</button>
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
                      <div key={n} className="flex justify-between items-center text-sm px-1 py-1">
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
                             <button onClick={() => toggleVeto(n)} className="ml-1 c-text-2 hover:c-text-red2"><Ban size={14} /></button>
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
                  <button onClick={() => persistir({ ...estado, margen: Math.max(0, +(estado.margen - 0.01).toFixed(2)) })} className="w-9 h-9 rounded-lg c-bg-app border c-bd-1 c-text-1 font-bold active:scale-90 transition-transform">–</button>
                  <span className="font-mono text-lg font-bold c-text-orange">{(estado.margen * 100).toFixed(0)}%</span>
                  <button onClick={() => persistir({ ...estado, margen: Math.min(0.3, +(estado.margen + 0.01).toFixed(2)) })} className="w-9 h-9 rounded-lg c-bg-app border c-bd-1 c-text-1 font-bold active:scale-90 transition-transform">+</button>
                </div>
              </Panel>
            )}
          </div>
        )}

        {tab === "historial" && (
          <div className="space-y-3">
            {estado.historial.length > 0 && (
              <button onClick={exportarHistorial} className="w-full rounded-lg border border-dashed c-bd-orange c-text-orange text-sm font-semibold py-2.5">
                ⬇️ Exportar historial a CSV
              </button>
            )}
            {estado.historial.length === 0 ? (
              <Panel icon={History} titulo="Historial">
                <p className="text-sm c-text-2">Aún no se ha cerrado ningún partido.</p>
              </Panel>
            ) : (
              estado.historial.map((p) => {
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
          <Ticket size={18} /> {slip.length} · {totalSlipStake.toFixed(2)} fichas (Posible: {totalSlipPremio.toFixed(2)})
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
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-t-2xl p-4 w-full max-w-md space-y-3 border-t c-bd-1 c-maxh-80vh overflow-y-auto c-anim-fadein-2">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1 flex items-center gap-1.5"><Ticket size={16} className="c-text-orange" /> Cesta de apuestas</div>
              <button onClick={() => setSlipOpen(false)} className="c-text-2"><X size={18} /></button>
            </div>
            {slip.length === 0 ? (
              <p className="text-sm c-text-2">La cesta está vacía.</p>
            ) : (
              <div className="space-y-2">
                {slip.length >= 2 && (
                  <div className="flex rounded-lg overflow-hidden border c-bd-1 text-sm font-semibold">
                    <button onClick={() => setModoSlip("simples")} className={`flex-1 py-1.5 ${modoSlip === "simples" ? "c-bg-orange c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>Simples</button>
                    <button onClick={() => setModoSlip("combinada")} className={`flex-1 py-1.5 ${modoSlip === "combinada" ? "c-bg-orange c-text-dark-on-accent" : "c-bg-app c-text-2"}`}>Combinada</button>
                  </div>
                )}
                {slip.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 c-bg-app rounded-lg p-2 border c-bd-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs c-text-2 truncate">{s.mercado}</div>
                      <div className="text-sm font-bold c-text-1">{s.seleccion} <span className="c-text-orange">Cuota: {s.cuota.toFixed(2)}</span></div>
                      {modoSlip === "simples" && (
                        <div className="text-[11px] c-text-green font-medium">Ganancia: {(s.stake * s.cuota).toFixed(2)} fichas</div>
                      )}
                    </div>
                    {modoSlip === "simples" || slip.length < 2 ? (
                      <input inputMode="decimal" value={s.stake} onChange={(e) => actualizarStakeSlip(s.id, e.target.value)} className="w-20 rounded-lg border c-bd-1 c-bg-white p-1.5 text-sm text-center c-text-1 shadow-sm" placeholder="Fichas" />
                    ) : null}
                    <button onClick={() => quitarDeSlip(s.id)} className="c-text-red2"><X size={16} /></button>
                  </div>
                ))}
                <input value={bettorSlip} onChange={(e) => setBettorSlip(e.target.value)} placeholder="¿Quién apuesta?" list="bettors-list" className="w-full rounded-lg border c-bd-1 c-bg-white p-2 text-sm c-text-1 shadow-sm" />
                <datalist id="bettors-list">{Object.keys(estado.bettors).map((n) => <option key={n} value={n} />)}</datalist>

                {modoSlip === "combinada" && slip.length >= 2 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm c-text-2">Fichas a jugar</span>
                      <input inputMode="decimal" value={stakeCombinada} onChange={(e) => setStakeCombinada(e.target.value)} className="flex-1 rounded-lg border c-bd-1 c-bg-white p-1.5 text-sm text-center c-text-1 shadow-sm" />
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Cuota combinada ({slip.length} patas)</span>
                      <span className="font-bold c-text-orange">{Math.max(1.01, slip.reduce((acc, s) => acc * s.cuota, 1)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Premio si aciertas todas</span>
                      <span className="font-bold c-text-green">{(Math.max(1.01, slip.reduce((acc, s) => acc * s.cuota, 1)) * (Number(stakeCombinada.replace(',', '.')) || 0)).toFixed(2)} fichas</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Total apostado</span><span className="font-bold c-text-1">{totalSlipStake.toFixed(2)} fichas</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Premio máximo total</span><span className="font-bold c-text-green">{totalSlipPremio.toFixed(2)} fichas</span>
                    </div>
                  </>
                )}

                <button onClick={confirmarSlip} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5 active:scale-95 transition-transform">
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
          perfil={construirPerfilJugador(estado.historial, perfilAbierto)}
          rating={ratingDe(perfilAbierto)}
          onCerrar={() => setPerfilAbierto(null)}
        />
      )}

      {pidiendoPassword && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPidiendoPassword(false)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1">
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
              <button onClick={confirmarPassword} className="flex-1 rounded-lg c-bg-orange c-text-dark-on-accent py-2 text-sm font-bold">Entrar</button>
            </div>
          </div>
        </div>
      )}

      {csvVisible !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-3" onClick={() => setCsvVisible(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-md space-y-2 border c-bd-1">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1">Historial exportado</div>
              <button onClick={() => setCsvVisible(null)} className="c-text-2"><X size={18} /></button>
            </div>
            <div className="text-xs c-text-2">Copia el texto de abajo y pégalo en Excel o Notas.</div>
            <textarea readOnly value={csvVisible} onClick={(e) => e.target.select()} className="w-full h-40 rounded-lg border c-bd-1 c-bg-app p-2 text-[11px] c-text-1" style={{ fontFamily: "'Space Mono', monospace" }} />
            <button onClick={copiarCSV} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5">
              {csvCopiado ? "✓ Copiado" : "📋 Copiar todo"}
            </button>
          </div>
        </div>
      )}

      {editarCuotaObjetivo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditarCuotaObjetivo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-xs space-y-3 border c-bd-1">
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
              className={`w-full rounded-lg border c-bd-1 p-2 text-lg font-bold text-center c-text-1 ${editarCuotaObjetivo.isLocked ? "c-bg-app opacity-50" : "c-bg-white"}`}
            />
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <div className="flex gap-2">
              <button onClick={guardarCuotaEditada} disabled={editarCuotaObjetivo.isLocked} className="flex-1 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2 text-sm disabled:opacity-50">Guardar</button>
              {boostDe(partido, editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion) && (
                <button onClick={quitarCuotaEditada} className="flex-1 rounded-lg border c-bd-1 c-text-2 font-bold py-2 text-sm">Restaurar</button>
              )}
            </div>
            {!editarCuotaObjetivo.isLocked && (
               <button onClick={bloquearCuota} className="w-full flex items-center justify-center gap-1 rounded-lg c-bg-red-soft c-text-red2 border c-bd-red-40 font-bold py-2 text-sm mt-2">
                 <Lock size={14} /> Bloquear Cuota
               </button>
            )}
          </div>
        </div>
      )}

      {modalNuevoMercado && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setModalNuevoMercado(false)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-sm space-y-3 border c-bd-1">
            <div className="flex justify-between items-center">
              <div className="font-bold c-text-1">Añadir mercado personalizado</div>
              <button onClick={() => setModalNuevoMercado(false)} className="c-text-2"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs c-text-2">Nombre del mercado</label>
                <input value={nombreMercadoCustom} onChange={(e) => setNombreMercadoCustom(e.target.value)} placeholder="Ej. Saques directos de Jorge" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1" />
              </div>
              <div>
                <label className="text-xs c-text-2">Selección o opción</label>
                <input value={seleccionMercadoCustom} onChange={(e) => setSeleccionMercadoCustom(e.target.value)} placeholder="Ej. Más de 3" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1" />
              </div>
              <div>
                <label className="text-xs c-text-2">Cuota</label>
                <input inputMode="decimal" value={cuotaMercadoCustom} onChange={(e) => setCuotaMercadoCustom(e.target.value)} placeholder="2.50" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1" />
              </div>
            </div>
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <button onClick={crearMercadoCustom} className="w-full rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5">
              Publicar mercado en mesa
            </button>
          </div>
        </div>
      )}

      {resolviendoCustoms && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setResolviendoCustoms(null)}>
          <div onClick={(e) => e.stopPropagation()} className="c-bg-white rounded-xl p-4 w-full max-w-sm space-y-3 border c-bd-1 c-maxh-80vh overflow-y-auto">
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
                     <div key={idCustom} className="p-3 rounded-lg c-bg-app border c-bd-1 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold flex-1">
                           {c.mercado}: <span className="c-text-orange">{c.seleccion}</span>
                        </div>
                        <div className="flex border c-bd-2 rounded-lg overflow-hidden shrink-0 font-bold text-xs">
                           <button onClick={() => setResolviendoCustoms({ respuestas: { ...resolviendoCustoms.respuestas, [idCustom]: true } })} className={`px-3 py-1.5 ${acertado ? "c-bg-green c-text-white" : "bg-white c-text-2 hover:bg-black/5"}`}>SÍ</button>
                           <button onClick={() => setResolviendoCustoms({ respuestas: { ...resolviendoCustoms.respuestas, [idCustom]: false } })} className={`px-3 py-1.5 ${!acertado ? "c-bg-red c-text-white" : "bg-white c-text-2 hover:bg-black/5"}`}>NO</button>
                        </div>
                     </div>
                  );
               })}
            </div>
            <button onClick={() => procesarCierrePartido(resolviendoCustoms.respuestas)} className="w-full mt-3 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2.5">
              Confirmar y Liquidar Todo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}