import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trophy, Crown, Plus, X, Check, Users, History, Swords, Ticket, RotateCcw, Loader2, Clock, Sun, Wind, Eye, EyeOff } from "lucide-react";

const RATING_INICIAL = 1000;
const K_FACTOR = 32;
const PENALIZACION_SOL = 60;
const FACTOR_VIENTO = 0.7;

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
const SD_PUNTOS = 4;

function ratingsEfectivas(ratingA, ratingB, ladoA, ladoB, solLado, viento) {
  const penA = solLado && ladoA === solLado ? PENALIZACION_SOL : 0;
  const penB = solLado && ladoB === solLado ? PENALIZACION_SOL : 0;
  let a = ratingA - penA;
  let b = ratingB - penB;
  if (viento) {
    const mid = (a + b) / 2;
    const diff = (a - b) * FACTOR_VIENTO;
    a = mid + diff / 2;
    b = mid - diff / 2;
  }
  return { a, b };
}

function calcularMercadosDesdeProbabilidad(pA, margen, historial, nombreA, nombreB) {
  const pB = 1 - pA;
  const closeness = 1 - Math.abs(2 * pA - 1);
  const perdedorEsperado = Math.round(19 * closeness);

  const ganador = { A: cuota(pA, margen), B: cuota(pB, margen), pA, pB };




  const perdedorEsperadoA = perdedorEsperadoJugador(historial, nombreA, perdedorEsperado);
  const perdedorEsperadoB = perdedorEsperadoJugador(historial, nombreB, perdedorEsperado);



  const handicaps = [3, 6, 10].map((k) => cuotaHandicap(pA, pB, perdedorEsperadoB, perdedorEsperadoA, margen, k));

  const esperadoA = pA * 21 + (1 - pA) * perdedorEsperadoA;
  const esperadoB = pB * 21 + (1 - pB) * perdedorEsperadoB;
  const puntosA = cuotaPuntosDefecto(pA, perdedorEsperadoA, esperadoA, margen);
  const puntosB = cuotaPuntosDefecto(pB, perdedorEsperadoB, esperadoB, margen);







  const probParcialesTeo = normCDF(2.5, perdedorEsperado, SD_PUNTOS);
  const probAjustadoTeo = Math.max(0, normCDF(20.5, perdedorEsperado, SD_PUNTOS) - normCDF(19.5, perdedorEsperado, SD_PUNTOS));
  const emp = analizarComoTermina(historial || []);
  const PESO_TEORICO = 6;
  const probParciales = (probParcialesTeo * PESO_TEORICO + emp.nParciales) / (PESO_TEORICO + emp.total);
  const probAjustado = (probAjustadoTeo * PESO_TEORICO + emp.nAjustado) / (PESO_TEORICO + emp.total);
  const probNormal = Math.max(0.01, 1 - probParciales - probAjustado);
  const comoTermina = {
    parciales: cuota(probParciales, margen),
    normal: cuota(probNormal, margen),
    ajustado: cuota(probAjustado, margen),
  };

  return { ganador, handicaps, puntosA, puntosB, esperadoA, esperadoB, comoTermina, perdedorEsperado, perdedorEsperadoA, perdedorEsperadoB };
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

function analizarComoTermina(historial) {
  let nParciales = 0, nNormal = 0, nAjustado = 0, total = 0;
  historial.forEach((p) => {
    if (!p.teamA || !p.teamB || p.teamA.length !== 1 || p.teamB.length !== 1) return;
    const ganoA = p.pa > p.pb;
    const winnerScore = ganoA ? p.pa : p.pb;
    const loserScore = ganoA ? p.pb : p.pa;
    total++;
    if (loserScore <= 2) nParciales++;
    else if (winnerScore > 21) nAjustado++;
    else nNormal++;
  });
  return { nParciales, nNormal, nAjustado, total };
}

function cuota(p, margen) {
  if (p <= 0) return 50;
  const conMargen = (1 / p) / (1 + margen);
  return Math.min(50, Math.max(1.01, conMargen));
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

function variacionSuficiente(pWin, perdedorEsperado, margen, rangoMin, rangoMax) {
  const enMin = cuotaPuntos(pWin, perdedorEsperado, margen, rangoMin);
  const enMax = cuotaPuntos(pWin, perdedorEsperado, margen, rangoMax);
  const UMBRAL = 1.15;
  const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);
  return {
    mostrarMas: ratio(enMin.cuotaMas, enMax.cuotaMas) >= UMBRAL,
    mostrarMenos: ratio(enMin.cuotaMenos, enMax.cuotaMenos) >= UMBRAL,
  };
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

function evaluarPata(mercado, seleccion, ctx) {
  const { ganador, pa, pb, nombreA, nombreB } = ctx;
  const margen = Math.abs(pa - pb);
  if (mercado === "Ganador") return seleccion === ganador;
  if (mercado.startsWith("Hándicap")) {
    const k = Number(mercado.match(/(\d+)/)[1]);
    return seleccion === ganador && margen >= k;
  }
  if (mercado.startsWith("Puntos")) {
    const m = mercado.match(/^Puntos (.+) ([\d.]+)$/);
    const jugadorRef = m ? m[1] : (mercado.includes(nombreA) ? nombreA : nombreB);
    const linea = m ? Number(m[2]) : 0;
    const puntosJ = jugadorRef === nombreA ? pa : pb;
    return seleccion === "Más" ? puntosJ > linea : puntosJ < linea;
  }
  if (mercado === "Cómo termina") {
    const ganoA = pa > pb;
    const winnerScore = ganoA ? pa : pb;
    const loserScore = ganoA ? pb : pa;
    if (seleccion === "parciales") return loserScore <= 2;
    if (seleccion === "ajustado") return winnerScore > 21;
    if (seleccion === "normal") return winnerScore <= 21 && loserScore >= 3;
  }
  return false;
}

function extraerInfoSeleccion(mercado, seleccion) {
  if (mercado === "Ganador") return { tipo: "ganador", jugador: seleccion };
  if (mercado.startsWith("Hándicap")) return { tipo: "handicap", k: Number(mercado.match(/(\d+)/)[1]), jugador: seleccion };
  if (mercado.startsWith("Puntos")) {
    const m = mercado.match(/^Puntos (.+) ([\d.]+)$/);
    return { tipo: "puntos", jugador: m ? m[1] : "", linea: m ? Number(m[2]) : 0, seleccion };
  }
  if (mercado === "Cómo termina") return { tipo: "comoTermina", opcion: seleccion };
  return { tipo: "otro" };
}

function sonContradictorias(a, b) {
  const ia = extraerInfoSeleccion(a.mercado, a.seleccion);
  const ib = extraerInfoSeleccion(b.mercado, b.seleccion);
  const esGanaOHandicap = (info) => info.tipo === "ganador" || info.tipo === "handicap";





  if (esGanaOHandicap(ia) && esGanaOHandicap(ib)) return true;




  if (esGanaOHandicap(ia) && ib.tipo === "puntos" && ib.jugador === ia.jugador) return true;
  if (esGanaOHandicap(ib) && ia.tipo === "puntos" && ia.jugador === ib.jugador) return true;




  if (ia.tipo === "puntos" && ib.tipo === "puntos" && ia.jugador === ib.jugador) {
    if (ia.seleccion === ib.seleccion) return true;
    const mas = ia.seleccion === "Más" ? ia : ib;
    const menos = ia.seleccion === "Menos" ? ia : ib;
    if (mas.linea >= menos.linea) return true;
  }

  if (ia.tipo === "comoTermina" && ib.tipo === "comoTermina") return true;

  const par = [ia, ib];
  const ajustado = par.find((x) => x.tipo === "comoTermina" && x.opcion === "ajustado");
  const handicap3 = par.find((x) => x.tipo === "handicap" && x.k >= 3);
  if (ajustado && handicap3) return true;




  const normal = par.find((x) => x.tipo === "comoTermina" && x.opcion === "normal");
  const handicap19 = par.find((x) => x.tipo === "handicap" && x.k >= 19);
  if (normal && handicap19) return true;

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
  } else if (margen >= 15) {
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
    const ganador = ganoA ? a : b, perdedor = ganoA ? b : a;
    const loserScore = ganoA ? p.pb : p.pa;
    const esDeuce = p.pa > 21 || p.pb > 21;
    ensure(a); ensure(b);
    if (loserScore <= 2) porJugador[ganador].parciales += 1;
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
    reyDeuce: top("deuce", 2),
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
  bettors: {}, partidoAbierto: null, historial: [],
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
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 15, esGM: true, forzarPendiente: "Javier",
    hora: "12:00", ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: true,
    hora: "12:10", ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, esGM: true,
    hora: "12:20", ladoA: "Columpios", ladoB: "Canasta", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, esGM: true,
    hora: "12:30", ladoA: "Columpios", ladoB: "Canasta", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 19, pb: 21, esGM: true,
    hora: "12:40", ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 15, pb: 21, esGM: true,
    hora: "12:50", ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 22, pb: 20, esGM: false,
    hora: "19:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 21, pb: 17, esGM: false,
    hora: "19:30", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 9, esGM: false,
    hora: "19:40", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Juan"], pa: 21, pb: 12, esGM: false,
    hora: "19:50", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Juan", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 21, pb: 19, esGM: false,
    hora: "20:00", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Juan", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 18, pb: 21, esGM: false,
    hora: "20:10", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Daniel", "Javier"], teamB: ["Álvaro", "Nicolás"], pa: 17, pb: 21, esGM: false,
    hora: "20:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },

  { teamA: ["Alberto"], teamB: ["Álvaro"], pa: 19, pb: 21, esGM: false,
    hora: "14:00", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: true },
  { teamA: ["Pedro"], teamB: ["Álvaro"], pa: 18, pb: 21, esGM: false,
    hora: "14:10", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: true },
  { teamA: ["Juan"], teamB: ["Álvaro"], pa: 15, pb: 21, esGM: false,
    hora: "14:20", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: true },
  { teamA: ["Nicolás"], teamB: ["Alberto"], pa: 19, pb: 21, esGM: false,
    hora: "14:40", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Juan"], teamB: ["Alberto"], pa: 21, pb: 13, esGM: false,
    hora: "14:50", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Pedro"], teamB: ["Alberto"], pa: 21, pb: 18, esGM: false,
    hora: "15:00", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 16, pb: 21, esGM: true,
    hora: "18:50", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 23, pb: 21, esGM: true,
    hora: "19:00", ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: true },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 25, pb: 23, esGM: true,
    hora: "19:10", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 22, pb: 20, esGM: true,
    hora: "19:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Javier"], teamB: ["Nicolás"], pa: 21, pb: 12, esGM: true,
    hora: "19:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },

  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 16, esGM: false,
    hora: "18:30", ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: false },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 19, esGM: false,
    hora: "18:40", ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 16, esGM: false,
    hora: "18:50", ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: false },
  { teamA: ["Javier"], teamB: ["Pedro"], pa: 9, pb: 1, esGM: false,
    hora: "19:00", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 17, pb: 21, esGM: false,
    hora: "19:00", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 18, pb: 21, esGM: false,
    hora: "19:10", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Pedro"], teamB: ["Jorge"], pa: 14, pb: 21, esGM: false,
    hora: "19:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 15, esGM: false,
    hora: "19:30", ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 15, esGM: false,
    hora: "19:40", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 18, esGM: false,
    hora: "19:50", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 22, pb: 20, esGM: false,
    hora: "20:00", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 18, esGM: false,
    hora: "20:10", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 22, pb: 20, esGM: false,
    hora: "12:20", ladoA: "Canasta", ladoB: "Columpios", solLado: "Canasta", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: false,
    hora: "12:30", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 21, pb: 14, esGM: false,
    hora: "12:40", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 23, pb: 21, esGM: false,
    hora: "12:50", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Álvaro"], pa: 19, pb: 21, esGM: false,
    hora: "13:00", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: false },
  { teamA: ["Jorge"], teamB: ["Álvaro"], pa: 21, pb: 18, esGM: false,
    hora: "13:10", ladoA: "Canasta", ladoB: "Columpios", solLado: null, viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 19, esGM: true,
    hora: "13:20", ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: false },
  { teamA: ["Nicolás"], teamB: ["Pedro"], pa: 22, pb: 20, esGM: false,
    hora: "18:30", ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: true },
  { teamA: ["Álvaro"], teamB: ["Nicolás"], pa: 21, pb: 19, esGM: false,
    ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Álvaro"], teamB: ["Javier"], pa: 14, pb: 21, esGM: false,
    ladoA: "Columpios", ladoB: "Canasta", solLado: null, viento: true },
  { teamA: ["Jorge"], teamB: ["Javier"], pa: 21, pb: 13, esGM: false,
    ladoA: "Columpios", ladoB: "Canasta", solLado: "Columpios", viento: true },
  { teamA: ["Pedro"], teamB: ["Jorge"], pa: 13, pb: 21, esGM: false,
    ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: false },
  { teamA: ["Álvaro"], teamB: ["Jorge"], pa: 11, pb: 21, esGM: false,
    ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: false },
  { teamA: ["Javier"], teamB: ["Jorge"], pa: 21, pb: 16, esGM: true,
    ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: false },
  { teamA: ["Javier"], teamB: ["Pedro"], pa: 9, pb: 1, esGM: false,
    ladoA: "Canasta", ladoB: "Columpios", solLado: "Columpios", viento: false },
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
  return { jugadores, gm, pendiente, margen: 0.08, bettors: {}, partidoAbierto: null, historial: historial.reverse() };
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

function BotonCuota({ etiqueta, valor, valorBase, boosteado, onClick, disabled, sub, activo }) {
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

/* Ticket de apuesta múltiple */
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
                <span className="shrink-0 c-text-orange font-bold">{ap.stake}×{ap.cuota.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
        <div className="text-[12px] space-y-1 c-text-3 pt-2">
          <div className="flex justify-between"><span>Total apostado</span><span className="font-bold c-text-1">{total} fichas</span></div>
          <div className="flex justify-between font-bold border-t border-dashed c-bd-1 pt-1 mt-1">
            <span>Premio máximo</span><span className="c-text-green">{premio.toFixed(0)} fichas</span>
          </div>
        </div>
      </div>
      <button onClick={onCerrar} className="mt-2 w-full text-center text-xs c-text-2 font-semibold underline">Cerrar</button>
    </div>
  );
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
              <div className="text-xs c-text-2">Rating {Math.round(rating)}</div>
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
  const [mostrarFormHistorico, setMostrarFormHistorico] = useState(false);
  const [histA, setHistA] = useState("");
  const [histB, setHistB] = useState("");
  const [histPa, setHistPa] = useState("");
  const [histPb, setHistPb] = useState("");
  const [histLadoA, setHistLadoA] = useState("Columpios");
  const [histSolLado, setHistSolLado] = useState(null);
  const [histViento, setHistViento] = useState(false);
  const [histHora, setHistHora] = useState("");
  const [histEsGM, setHistEsGM] = useState(false);
  const [lineaA, setLineaA] = useState(12);
  const [lineaB, setLineaB] = useState(12);
  const [ticketVisible, setTicketVisible] = useState(null);
  const [marcador, setMarcador] = useState({ a: "", b: "" });
  const [error, setError] = useState("");
  const [celebracion, setCelebracion] = useState(null);
  const [confirmBorrar, setConfirmBorrar] = useState(false);
  const [modoEspectador, setModoEspectador] = useState(false);
  const [pidiendoPassword, setPidiendoPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [csvVisible, setCsvVisible] = useState(null);
  const [csvCopiado, setCsvCopiado] = useState(false);
  const [fabPop, setFabPop] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(null); // nombre del jugador cuyo perfil se está viendo
  const [modoEditarCuotas, setModoEditarCuotas] = useState(false);
  const [editarCuotaObjetivo, setEditarCuotaObjetivo] = useState(null); // { mercado, seleccion, valorBase, etiqueta }
  const [editarCuotaInput, setEditarCuotaInput] = useState("");
  const prevSlipLen = useRef(0);

  useEffect(() => {
    (async () => {
      const cargado = await cargarEstado();
      setEstado(cargado || ESTADO_DEFECTO);
      setCargando(false);
    })();
  }, []);

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
    // La descarga automática puede estar bloqueada dentro del artefacto (entorno
    // aislado), así que la intentamos mostrando el texto para copiar en cualquier caso.
    try { descargarCSV(csv, "pinamax_historial.csv"); } catch (e) {  }
    setCsvCopiado(false);
    setCsvVisible(csv);
  }

  async function copiarCSV() {
    try {
      await navigator.clipboard.writeText(csvVisible);
      setCsvCopiado(true);
    } catch (e) {
      setError("No se pudo copiar automáticamente. Selecciona el texto a mano y cópialo.");
    }
  }

  function crearPartido() {
    setError("");
    if (!selA || !selB || selA === selB) { setError("Elige dos jugadores distintos."); return; }
    const auto = (selA === estado.gm || selB === estado.gm);
    const nuevo = {
      id: Date.now(), a: selA, b: selB, esGM: esGM && auto, apuestas: [],
      hora: horaInput, ladoA: ladoAInput, ladoB: ladoBAuto, solLado: solLadoInput, viento: vientoInput,
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
    setSlip([]);
    persistir({ ...estado, partidoAbierto: null });
  }

  function abrirEditorCuota(mercado, seleccion, valorBase, etiqueta) {
    const actual = boostDe(partido, mercado, seleccion);
    setEditarCuotaObjetivo({ mercado, seleccion, valorBase, etiqueta });
    setEditarCuotaInput(actual ? String(actual) : "");
    setError("");
  }

  function guardarCuotaEditada() {
    const { mercado, seleccion } = editarCuotaObjetivo;
    const val = editarCuotaInput.trim() ? Number(editarCuotaInput) : null;
    if (editarCuotaInput.trim() && (!val || val < 1.01)) {
      setError("La cuota mejorada tiene que ser un número válido de al menos 1.01.");
      return;
    }
    const nuevosBoosts = { ...(partido.boosts || {}) };
    const clave = claveBoost(mercado, seleccion);
    if (val) nuevosBoosts[clave] = val; else delete nuevosBoosts[clave];
    persistir({ ...estado, partidoAbierto: { ...partido, boosts: nuevosBoosts } });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
    setError("");
  }

  function quitarCuotaEditada() {
    if (!editarCuotaObjetivo) return;
    const nuevosBoosts = { ...(partido.boosts || {}) };
    delete nuevosBoosts[claveBoost(editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion)];
    persistir({ ...estado, partidoAbierto: { ...partido, boosts: nuevosBoosts } });
    setEditarCuotaObjetivo(null);
    setEditarCuotaInput("");
  }

  // Punto único por el que pasa cualquier toque a una cuota: si estamos en modo
  // "editar cuotas" (solo disponible en modo boss) abre el editor de esa

  function manejarClicCuota(mercado, seleccion, valorBase, etiqueta) {
    if (modoEditarCuotas && !modoEspectador) {
      abrirEditorCuota(mercado, seleccion, valorBase, etiqueta);
      return;
    }
    const valorFinal = boostDe(partido, mercado, seleccion) ?? valorBase;
    toggleSlip(mercado, seleccion, valorFinal);
  }

  function estaEnSlip(mercado, seleccion) {
    return slip.find((s) => s.mercado === mercado && s.seleccion === seleccion);
  }

  function toggleSlip(mercado, seleccion, cuota) {
    const existente = estaEnSlip(mercado, seleccion);
    if (existente) { setSlip(slip.filter((s) => s.id !== existente.id)); return; }
    const nuevaSel = { mercado, seleccion };
    const conflicto = slip.find((s) => sonContradictorias(s, nuevaSel));
    if (conflicto) {
      setError(`"${seleccion}" es contraria a tu selección "${conflicto.mercado}: ${conflicto.seleccion}" — no se pueden combinar.`);
      return;
    }
    setError("");
    setSlip([...slip, { id: Date.now() + Math.random(), mercado, seleccion, cuota, stake: 50 }]);
  }

  function actualizarStakeSlip(id, valor) {
    setSlip(slip.map((s) => (s.id === id ? { ...s, stake: Number(valor) || 0 } : s)));
  }
  function quitarDeSlip(id) {
    setSlip(slip.filter((s) => s.id !== id));
  }

  function confirmarSlip() {
    const nombre = bettorSlip.trim();
    if (!nombre) { setError("Pon el nombre de quién apuesta."); return; }
    const saldoActual = estado.bettors[nombre] ?? 500;
    const rachaApostante = calcularRachaApuestas(estado.historial, nombre);
    const bonus = bonusPorRachaApostante(rachaApostante);

    if (modoSlip === "combinada" && slip.length >= 2) {
      const stake = Number(stakeCombinada) || 0;
      if (stake <= 0) { setError("Pon una cantidad de fichas válida."); return; }
      if (saldoActual < stake) { setError(`${nombre} solo tiene ${saldoActual} fichas.`); return; }
      const cuotaTotal = Math.max(1.01, slip.reduce((acc, s) => acc * s.cuota, 1) * bonus);
      setError("");
      const apuesta = {
        id: Date.now(), bettor: nombre, tipo: "combinada",
        patas: slip.map((s) => ({ mercado: s.mercado, seleccion: s.seleccion, cuota: s.cuota, boosteada: !!boostDe(partido, s.mercado, s.seleccion) })),
        cuota: cuotaTotal, stake, estado: "pendiente", bonusRacha: bonus > 1 ? bonus : null,
      };
      const nuevosBettors = { ...estado.bettors, [nombre]: saldoActual - stake };
      const nuevoPartido = { ...partido, apuestas: [...partido.apuestas, apuesta] };
      persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido });
      setTicketVisible({ bettor: nombre, apuestas: [apuesta] });
      if (slip.some((s) => boostDe(partido, s.mercado, s.seleccion))) setCelebracion({ nombre, tipo: "supercuota" });
      setSlip([]); setSlipOpen(false); setBettorSlip(""); setStakeCombinada("50");
      return;
    }

    const totalStake = slip.reduce((s, x) => s + x.stake, 0);
    if (slip.some((s) => !s.stake || s.stake <= 0)) { setError("Todas las apuestas necesitan una cantidad de fichas."); return; }
    if (saldoActual < totalStake) { setError(`${nombre} solo tiene ${saldoActual} fichas y esta cesta suma ${totalStake}.`); return; }
    setError("");
    const nuevasApuestas = slip.map((s) => ({ id: s.id, bettor: nombre, mercado: s.mercado, seleccion: s.seleccion, cuota: Math.max(1.01, s.cuota * bonus), stake: s.stake, estado: "pendiente", bonusRacha: bonus > 1 ? bonus : null, boosteada: !!boostDe(partido, s.mercado, s.seleccion) }));
    const nuevosBettors = { ...estado.bettors, [nombre]: saldoActual - totalStake };
    const nuevoPartido = { ...partido, apuestas: [...partido.apuestas, ...nuevasApuestas] };
    persistir({ ...estado, bettors: nuevosBettors, partidoAbierto: nuevoPartido });
    setTicketVisible({ bettor: nombre, apuestas: nuevasApuestas });
    if (slip.some((s) => boostDe(partido, s.mercado, s.seleccion))) setCelebracion({ nombre, tipo: "supercuota" });
    setSlip([]); setSlipOpen(false); setBettorSlip("");
  }

  function agregarResultadoHistorico() {
    const a = histA.trim(), b = histB.trim();
    const pa = Number(histPa), pb = Number(histPb);
    if (!a || !b || a === b) { setError("Elige dos jugadores distintos."); return; }
    if (isNaN(pa) || isNaN(pb) || pa === pb) { setError("Introduce un marcador válido (sin empate)."); return; }
    if (Math.abs(pa - pb) < 2) { setError("En pingpong se gana por al menos 2 puntos de diferencia."); return; }
    setError("");

    const ladoB = histLadoA === "Canasta" ? "Columpios" : "Canasta";
    const ratingA0 = ratingDe(a), ratingB0 = ratingDe(b);
    const ganoA = pa > pb;
    const ganador = ganoA ? a : b;
    const perdedor = ganoA ? b : a;
    const { pA: pAjustadaA } = probabilidadYDetalle(estado.historial, a, b, ratingA0, ratingB0, histLadoA, ladoB, histSolLado, histViento);
    const pBajustadaB = 1 - pAjustadaA;
    const sA_ = ganoA ? 1 : 0, sB_ = ganoA ? 0 : 1;
    const nuevoA = ratingA0 + K_FACTOR * (sA_ - pAjustadaA);
    const nuevoB = ratingB0 + K_FACTOR * (sB_ - pBajustadaB);
    const { gm, pendiente } = actualizarTitulo(estado.gm, estado.pendiente, histEsGM, ganador);

    const partidoCerrado = {
      id: Date.now() + Math.random(), a, b, esGM: !!histEsGM,
      hora: histHora.trim() || null, ladoA: histLadoA, ladoB, solLado: histSolLado || null, viento: !!histViento,
      pa, pb, ganador, perdedor,
      teamA: [a], teamB: [b], aLabel: a, bLabel: b,
      ratingsAntes: { [a]: ratingA0, [b]: ratingB0 },
      ratingsDespues: { [a]: nuevoA, [b]: nuevoB },
      apuestas: [],
      fecha: new Date().toISOString(),
    };
    const coronacion = !!(gm && gm !== estado.gm);
    const rachaRota = calcularRacha(estado.historial, perdedor) >= 3;
    partidoCerrado.titular = generarTitular(partidoCerrado, coronacion, rachaRota);
    if (gm && gm !== estado.gm) setCelebracion({ nombre: gm, tipo: "gm" });

    persistir({
      ...estado,
      jugadores: { ...estado.jugadores, [a]: nuevoA, [b]: nuevoB },
      gm, pendiente,
      historial: [partidoCerrado, ...estado.historial],
    });


    setHistPa(""); setHistPb(""); setHistHora(""); setHistEsGM(false);
  }

  function registrarResultado() {
    const pa = Number(marcador.a), pb = Number(marcador.b);
    if (isNaN(pa) || isNaN(pb) || pa === pb) { setError("Introduce un marcador válido (sin empate)."); return; }
    if (Math.abs(pa - pb) < 2) { setError("En pingpong se gana por al menos 2 puntos de diferencia (ej. 21-19, o 23-21 si hubo empate a 20)."); return; }
    setError("");
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
        const todasAciertan = ap.patas.every((p) => evaluarPata(p.mercado, p.seleccion, ctx));
        return { ...ap, estado: todasAciertan ? "ganada" : "perdida" };
      }
      const acierto = evaluarPata(ap.mercado, ap.seleccion, ctx);
      return { ...ap, estado: acierto ? "ganada" : "perdida" };
    });

    const nuevosBettors = { ...estado.bettors };
    apuestasResueltas.forEach((ap) => {
      if (ap.estado === "ganada") nuevosBettors[ap.bettor] = (nuevosBettors[ap.bettor] ?? 500) + ap.stake * ap.cuota;
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
  // Combina la cuota base (con autobalanceo por dinero) con el boost manual si
  // existe, para CUALQUIER mercado — no solo Ganador.
  const conBoost = (mercado, seleccion, base) => {
    const b = partido ? boostDe(partido, mercado, seleccion) : null;
    return { valor: b ?? base, base, boosteado: b != null };
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
  const hayBoostsActivos = partido?.boosts && Object.keys(partido.boosts).length > 0;
  const totalSlipStake = slip.reduce((s, x) => s + x.stake, 0);
  const totalSlipPremio = slip.reduce((s, x) => s + x.stake * x.cuota, 0);

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
                {!modoEspectador && <button onClick={cancelarPartido} className="c-text-2 hover:c-text-1 text-xs underline">cancelar</button>}
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
                <div className="text-[10px] c-text-4 pt-1">Con pocos partidos el efecto se atenúa automáticamente (no se dispara al 100% solo por 1 o 2 resultados).</div>
              </Panel>
            )}

            <Panel icon={Trophy} titulo="Ganador" badge={
              !modoEspectador && (
                <button onClick={() => setModoEditarCuotas(!modoEditarCuotas)} className={`text-[10px] underline font-bold ${modoEditarCuotas ? "c-text-mesa" : "c-text-orange"}`}>
                  {modoEditarCuotas ? "✓ editando cuotas (toca una)" : "✏️ editar cuotas"}
                </button>
              )
            }>
              {(Math.abs(rachaA) >= 3 || Math.abs(rachaB) >= 3) && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {Math.abs(rachaA) >= 3 && <Chip tone={rachaA > 0 ? "gold" : "info"}>{rachaA > 0 ? "🔥" : "❄️"} {partido.a} {Math.abs(rachaA)} seguidas {rachaA > 0 ? "ganadas" : "perdidas"}</Chip>}
                  {Math.abs(rachaB) >= 3 && <Chip tone={rachaB > 0 ? "gold" : "info"}>{rachaB > 0 ? "🔥" : "❄️"} {partido.b} {Math.abs(rachaB)} seguidas {rachaB > 0 ? "ganadas" : "perdidas"}</Chip>}
                </div>
              )}
              {hayBoostsActivos && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  <Chip tone="gold">🔥 hay supercuotas activas en esta mesa</Chip>
                </div>
              )}
              {!bGanadorA.boosteado && !bGanadorB.boosteado && ganadorConDinero && Math.abs(ganadorConDinero.ajuste) > 0.01 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  <Chip tone="info">
                    ⚖️ {stakeGanadorA > stakeGanadorB ? partido.a : partido.b} tiene más dinero apostado ({Math.round(100 * Math.max(stakeGanadorA, stakeGanadorB) / (stakeGanadorA + stakeGanadorB))}%) · cuotas ajustadas
                  </Chip>
                </div>
              )}
              <div className="flex gap-2">
                <BotonCuota etiqueta={partido.a} valor={bGanadorA.valor} valorBase={bGanadorA.base} boosteado={bGanadorA.boosteado} activo={!!estaEnSlip("Ganador", partido.a)} onClick={() => manejarClicCuota("Ganador", partido.a, ganadorConDinero.A, partido.a)} />
                <BotonCuota etiqueta={partido.b} valor={bGanadorB.valor} valorBase={bGanadorB.base} boosteado={bGanadorB.boosteado} activo={!!estaEnSlip("Ganador", partido.b)} onClick={() => manejarClicCuota("Ganador", partido.b, ganadorConDinero.B, partido.b)} />
              </div>
            </Panel>

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
                    {handicapLados.mostrarMas && <BotonCuota etiqueta={`Gana ${partido.a}`} valor={bHandicapA.valor} valorBase={bHandicapA.base} boosteado={bHandicapA.boosteado} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.a)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.a, handicapVivo.cuotaA, `Gana ${partido.a}`)} />}
                    {handicapLados.mostrarMenos && <BotonCuota etiqueta={`Gana ${partido.b}`} valor={bHandicapB.valor} valorBase={bHandicapB.base} boosteado={bHandicapB.boosteado} activo={!!estaEnSlip(`Hándicap ${handicapKClamp}`, partido.b)} onClick={() => manejarClicCuota(`Hándicap ${handicapKClamp}`, partido.b, handicapVivo.cuotaB, `Gana ${partido.b}`)} />}
                  </div>
                )}
                {handicapVivo && !handicapLados.mostrarMas && !handicapLados.mostrarMenos && (
                  <p className="text-[10px] c-text-2">Con este margen, la cuota ya no varía; prueba a bajar el número.</p>
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
                      {variacionA.mostrarMas && <BotonCuota etiqueta="Más de" sub={`${lineaAClamp}`} valor={bPuntosAMas.valor} valorBase={bPuntosAMas.base} boosteado={bPuntosAMas.boosteado} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}`, "Más", puntosAVivo.cuotaMas, `${partido.a} más de ${lineaAClamp}`)} />}
                      {variacionA.mostrarMenos && <BotonCuota etiqueta="Menos de" sub={`${lineaAClamp}`} valor={bPuntosAMenos.valor} valorBase={bPuntosAMenos.base} boosteado={bPuntosAMenos.boosteado} activo={!!estaEnSlip(`Puntos ${partido.a} ${lineaAClamp}`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.a} ${lineaAClamp}`, "Menos", puntosAVivo.cuotaMenos, `${partido.a} menos de ${lineaAClamp}`)} />}
                    </div>
                  )}
                  {puntosAVivo && !variacionA.mostrarMas && !variacionA.mostrarMenos && (
                    <p className="text-[10px] c-text-2 mt-1">Sin apuesta de puntos interesante para {partido.a} en este partido (la cuota casi no cambia).</p>
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
                      {variacionB.mostrarMas && <BotonCuota etiqueta="Más de" sub={`${lineaBClamp}`} valor={bPuntosBMas.valor} valorBase={bPuntosBMas.base} boosteado={bPuntosBMas.boosteado} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}`, "Más")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}`, "Más", puntosBVivo.cuotaMas, `${partido.b} más de ${lineaBClamp}`)} />}
                      {variacionB.mostrarMenos && <BotonCuota etiqueta="Menos de" sub={`${lineaBClamp}`} valor={bPuntosBMenos.valor} valorBase={bPuntosBMenos.base} boosteado={bPuntosBMenos.boosteado} activo={!!estaEnSlip(`Puntos ${partido.b} ${lineaBClamp}`, "Menos")} onClick={() => manejarClicCuota(`Puntos ${partido.b} ${lineaBClamp}`, "Menos", puntosBVivo.cuotaMenos, `${partido.b} menos de ${lineaBClamp}`)} />}
                    </div>
                  )}
                  {puntosBVivo && !variacionB.mostrarMas && !variacionB.mostrarMenos && (
                    <p className="text-[10px] c-text-2 mt-1">Sin apuesta de puntos interesante para {partido.b} en este partido (la cuota casi no cambia).</p>
                  )}
                </div>
              </div>
            </Panel>

            <Panel icon={Trophy} titulo="Cómo termina el partido">
              <div className="flex gap-2">
                <BotonCuota etiqueta="Parciales (rival ≤2)" valor={bComoParciales.valor} valorBase={bComoParciales.base} boosteado={bComoParciales.boosteado} activo={!!estaEnSlip("Cómo termina", "parciales")} onClick={() => manejarClicCuota("Cómo termina", "parciales", mercados.comoTermina.parciales, "Parciales")} />
                <BotonCuota etiqueta="Normal (3-19)" valor={bComoNormal.valor} valorBase={bComoNormal.base} boosteado={bComoNormal.boosteado} activo={!!estaEnSlip("Cómo termina", "normal")} onClick={() => manejarClicCuota("Cómo termina", "normal", mercados.comoTermina.normal, "Normal")} />
                <BotonCuota etiqueta="Ajustado (deuce)" valor={bComoAjustado.valor} valorBase={bComoAjustado.base} boosteado={bComoAjustado.boosteado} activo={!!estaEnSlip("Cómo termina", "ajustado")} onClick={() => manejarClicCuota("Cómo termina", "ajustado", mercados.comoTermina.ajustado, "Ajustado")} />
              </div>
              <p className="text-[10px] c-text-2">Parciales: el rival se queda en 0, 1 o 2 puntos (7-0, 9-1, 11-2...). Normal: se llega a 21 con el rival entre 3 y 19. Ajustado: hay que pasar de 21 y se gana por 2 (22-20, 23-21...). Las probabilidades se calculan mezclando el modelo con los partidos reales ya jugados.</p>
            </Panel>

            {partido.apuestas.length > 0 && (
              <Panel icon={Ticket} titulo={`Apuestas de esta mesa (${partido.apuestas.length})`}>
                <div className="space-y-1">
                  {partido.apuestas.map((ap) => (
                    <div key={ap.id} className="flex justify-between text-xs border-b c-bd-2 pb-1 c-text-3">
                      <span className="flex items-center gap-1">
                        <Avatar name={ap.bettor} size={16} />{ap.bettor} ·{" "}
                        {ap.tipo === "combinada" ? `Combinada (${ap.patas.length}): ${ap.patas.map((p) => `${p.seleccion}`).join(" + ")}` : `${ap.mercado} · ${ap.seleccion}`}
                      </span>
                      <span className="font-mono c-text-orange">{ap.stake} × {ap.cuota.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {!modoEspectador && (
              <Panel icon={Check} titulo="Registrar resultado final">
                <div className="flex items-center gap-2">
                  <input inputMode="numeric" placeholder={partido.a} value={marcador.a} onChange={(e) => setMarcador({ ...marcador, a: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1" />
                  <span className="c-text-2">–</span>
                  <input inputMode="numeric" placeholder={partido.b} value={marcador.b} onChange={(e) => setMarcador({ ...marcador, b: e.target.value })} className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm text-center c-text-1" />
                </div>
                <button onClick={registrarResultado} className="w-full mt-2 rounded-lg c-bg-green c-text-green-dark font-bold py-2.5 active:scale-95 transition-transform">
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
                        {!estado.gm && !modoEspectador && <span onClick={(e) => { e.stopPropagation(); fijarGMInicial(n); }} className="text-[10px] underline c-text-orange shrink-0">hacer Gran Maestro</span>}
                      </div>
                      <span className="font-mono text-sm c-text-orange font-bold shrink-0">{Math.round(estado.jugadores[n])}</span>
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
                        return (
                          <div key={n} className="flex flex-col items-center gap-1 w-16">
                            <Avatar name={n} size={26} />
                            <div className="text-[10px] c-text-1 font-semibold truncate w-full text-center">{n}</div>
                            <div className={`w-full ${alturaOrden} rounded-t-md c-grad-podio border c-bd-2b flex flex-col items-center justify-end pb-1`}>
                              <span className="text-lg">{medalla}</span>
                              <span className="text-[10px] font-mono font-bold c-text-orange">{Math.round(saldo)}</span>
                            </div>
                            {est.total > 0 && <div className="text-[9px] c-text-2">{est.aciertos}/{est.total} ({Math.round(100 * est.aciertos / est.total)}%)</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {resto.map(([n, saldo], i) => {
                    const est = estadisticasApostantes[n] || { total: 0, aciertos: 0 };
                    return (
                      <div key={n} className="flex justify-between items-center text-sm px-1">
                        <span className="flex items-center gap-2 c-text-3"><span className="text-xs c-text-2 w-4">{i + 4}</span><Avatar name={n} size={20} />{n}</span>
                        <span className="flex items-center gap-2">
                          {est.total > 0 && <span className="text-[10px] c-text-2">{est.aciertos}/{est.total} ({Math.round(100 * est.aciertos / est.total)}%)</span>}
                          <span className="font-mono font-bold c-text-1">{Math.round(saldo)}</span>
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

            {(() => {
              const registrosGlobales = construirRegistrosPorJugador(estado.historial);
              const todos = Object.values(registrosGlobales).flat();
              const pct = (subset) => (subset.length ? `${subset.filter((r) => r.gano).length}/${subset.length} (${Math.round((100 * subset.filter((r) => r.gano).length) / subset.length)}%)` : "–");
              const canasta = todos.filter((r) => r.lado === "Canasta");
              const columpios = todos.filter((r) => r.lado === "Columpios");
              if (todos.length === 0) return null;
              return (
                <Panel icon={Users} titulo="Estadísticas por campo">
                  <div className="flex justify-between text-xs c-text-3 pb-1 border-b c-bd-2">
                    <span>Global en Canasta</span><span className="font-mono">{pct(canasta)}</span>
                  </div>
                  <div className="flex justify-between text-xs c-text-3 pb-2">
                    <span>Global en Columpios</span><span className="font-mono">{pct(columpios)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="c-text-2 text-left">
                          <th className="font-semibold pb-1">Jugador</th>
                          <th className="font-semibold pb-1 text-right">Canasta</th>
                          <th className="font-semibold pb-1 text-right">Columpios</th>
                          <th className="font-semibold pb-1 text-right">Sol en contra</th>
                          <th className="font-semibold pb-1 text-right">Viento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(registrosGlobales).map((n) => {
                          const regs = registrosGlobales[n];
                          return (
                            <tr key={n} className="border-t c-bd-2">
                              <td className="py-1 c-text-1 flex items-center gap-1"><Avatar name={n} size={16} />{n}</td>
                              <td className="py-1 text-right font-mono c-text-3">{pct(regs.filter((r) => r.lado === "Canasta"))}</td>
                              <td className="py-1 text-right font-mono c-text-3">{pct(regs.filter((r) => r.lado === "Columpios"))}</td>
                              <td className="py-1 text-right font-mono c-text-3">{pct(regs.filter((r) => r.solLeMolesta))}</td>
                              <td className="py-1 text-right font-mono c-text-3">{pct(regs.filter((r) => r.viento))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[10px] c-text-4 pt-1">Solo partidos individuales (los dobles no se cuentan aquí). Estas son las cifras en bruto; las cuotas las ajustan de forma más prudente cuando hay pocos partidos.</div>
                </Panel>
              );
            })()}
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
                  <Panel key={p.id} icon={History} titulo={`${fechaStr} · ${horaStr}`}>
                    {p.titular && <p style={{ fontFamily: "'Caveat', cursive" }} className="text-lg c-text-mesa font-bold leading-tight">"{p.titular}"</p>}
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif" }} className="text-lg tracking-wide c-text-1 flex items-center gap-2 flex-wrap">
                      {p.aLabel} <span className={p.ganador === p.aLabel ? "c-text-green" : "c-text-red2"}>{p.pa}</span> – <span className={p.ganador === p.bLabel ? "c-text-green" : "c-text-red2"}>{p.pb}</span> {p.bLabel} {p.esGM && "👑"}
                    </div>
                    <CondicionesBadges hora={null} ladoA={p.ladoA} ladoB={p.ladoB} solLado={p.solLado} viento={p.viento} nombreA={p.aLabel} nombreB={p.bLabel} />
                    <div className="text-xs c-text-2">
                      Ganó <b className="c-text-green">{p.ganador}</b> · ratings:{" "}
                      {Object.entries(p.ratingsAntes).map(([n, antes], i) => (
                        <span key={n}>{i > 0 && ", "}{n} {Math.round(antes)}→{Math.round(p.ratingsDespues[n])}</span>
                      ))}
                    </div>
                    {p.apuestas.length > 0 && (
                      <div className="pt-1 space-y-0.5">
                        {p.apuestas.map((ap) => (
                          <div key={ap.id} className={`text-xs flex justify-between ${ap.estado === "ganada" ? "c-text-green" : "c-text-red2"}`}>
                            <span>{ap.bettor} · {ap.tipo === "combinada" ? `Combinada (${ap.patas.length}): ${ap.patas.map((pt) => pt.seleccion).join(" + ")}` : `${ap.mercado} · ${ap.seleccion}`}</span>
                            <span className="font-semibold">{ap.estado === "ganada" ? `+${Math.round(ap.stake * ap.cuota)}` : `-${ap.stake}`}</span>
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
          <Ticket size={18} /> {slip.length} · {totalSlipStake} fichas
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
                      <div className="text-sm font-bold c-text-1">{s.seleccion} <span className="c-text-orange">{s.cuota.toFixed(2)}</span></div>
                    </div>
                    {modoSlip === "simples" || slip.length < 2 ? (
                      <input inputMode="numeric" value={s.stake} onChange={(e) => actualizarStakeSlip(s.id, e.target.value)} className="w-16 rounded-lg border c-bd-1 c-bg-app p-1.5 text-sm text-center c-text-1" />
                    ) : null}
                    <button onClick={() => quitarDeSlip(s.id)} className="c-text-red2"><X size={16} /></button>
                  </div>
                ))}
                <input value={bettorSlip} onChange={(e) => setBettorSlip(e.target.value)} placeholder="¿Quién apuesta?" list="bettors-list" className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-sm c-text-1" />
                <datalist id="bettors-list">{Object.keys(estado.bettors).map((n) => <option key={n} value={n} />)}</datalist>

                {modoSlip === "combinada" && slip.length >= 2 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm c-text-2">Fichas a jugar</span>
                      <input inputMode="numeric" value={stakeCombinada} onChange={(e) => setStakeCombinada(e.target.value)} className="flex-1 rounded-lg border c-bd-1 c-bg-app p-1.5 text-sm text-center c-text-1" />
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Cuota combinada ({slip.length} patas)</span>
                      <span className="font-bold c-text-orange">{Math.max(1.01, slip.reduce((acc, s) => acc * s.cuota, 1)).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Premio si aciertas todas</span>
                      <span className="font-bold c-text-green">{(Math.max(1.01, slip.reduce((acc, s) => acc * s.cuota, 1)) * (Number(stakeCombinada) || 0)).toFixed(0)} fichas</span>
                    </div>
                    <p className="text-[10px] c-text-2">Solo se paga si aciertan TODAS las patas.</p>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Total apostado</span><span className="font-bold c-text-1">{totalSlipStake} fichas</span>
                    </div>
                    <div className="flex justify-between text-sm c-text-3 px-1">
                      <span>Premio máximo</span><span className="font-bold c-text-green">{totalSlipPremio.toFixed(0)} fichas</span>
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
            <div className="text-xs c-text-2">Se ha intentado descargar el archivo. Si tu navegador no lo ha permitido, copia el texto de abajo y pégalo en Excel, Sheets o Notas.</div>
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
                <div className="text-[10px] uppercase font-bold c-text-2">Cuota mejorada</div>
                <div className="font-bold c-text-1">{editarCuotaObjetivo.etiqueta}</div>
                <div className="text-xs c-text-2">Cuota calculada: {editarCuotaObjetivo.valorBase.toFixed(2)}</div>
              </div>
              <button onClick={() => setEditarCuotaObjetivo(null)} className="c-text-2"><X size={18} /></button>
            </div>
            <input
              inputMode="decimal" value={editarCuotaInput} onChange={(e) => setEditarCuotaInput(e.target.value)}
              placeholder={editarCuotaObjetivo.valorBase.toFixed(2)} autoFocus
              className="w-full rounded-lg border c-bd-1 c-bg-app p-2 text-lg font-bold text-center c-text-1"
            />
            {error && <div className="text-xs c-text-red2 font-semibold">{error}</div>}
            <div className="flex gap-2">
              <button onClick={guardarCuotaEditada} className="flex-1 rounded-lg c-bg-orange c-text-dark-on-accent font-bold py-2 text-sm">Guardar</button>
              {boostDe(partido, editarCuotaObjetivo.mercado, editarCuotaObjetivo.seleccion) && (
                <button onClick={quitarCuotaEditada} className="flex-1 rounded-lg border c-bd-1 c-text-2 font-bold py-2 text-sm">Quitar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
