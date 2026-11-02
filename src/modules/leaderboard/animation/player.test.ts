import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelinePlayer } from "./player";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("lecture de la séquence", () => {
  it("avance, s'arrête à la fin et recommence au début sur une nouvelle lecture", () => {
    const render = vi.fn();
    const player = new TimelinePlayer(render, vi.fn());
    player.setLength(3);
    player.play();
    expect(player.index).toBe(1);
    expect(render).toHaveBeenLastCalledWith(1, true, 1500);
    vi.advanceTimersByTime(1500);
    expect(player.index).toBe(2);
    expect(player.playing).toBe(true);
    expect(render).toHaveBeenLastCalledWith(2, true, 1500);
    vi.advanceTimersByTime(1500);
    expect(player.index).toBe(2);
    expect(player.playing).toBe(false);
    player.play();
    expect(player.position).toBe(0);
    expect(render).toHaveBeenLastCalledWith(1, true, 1500);
    player.pause();
  });

  it("arrête les temporisateurs lors d'une pause ou d'un déplacement manuel", () => {
    const player = new TimelinePlayer(vi.fn(), vi.fn());
    player.setLength(5);
    player.play();
    player.pause();
    vi.advanceTimersByTime(10000);
    expect(player.position).toBe(0);
    player.play();
    player.seek(3);
    vi.advanceTimersByTime(10000);
    expect(player.index).toBe(3);
    expect(player.playing).toBe(false);
  });

  it("change la vitesse sans lancer plusieurs temporisateurs", () => {
    const player = new TimelinePlayer(vi.fn(), vi.fn());
    player.setLength(5);
    player.play();
    player.play();
    player.setInterval(750);
    vi.advanceTimersByTime(750);
    expect(player.position).toBe(1);
    vi.advanceTimersByTime(750);
    expect(player.position).toBe(2);
    player.pause();
  });

  it("annule la lecture lorsque les filtres remplacent la séquence", () => {
    const render = vi.fn();
    const player = new TimelinePlayer(render, vi.fn());
    player.setLength(10);
    player.play();
    player.setLength(2, 20);
    vi.advanceTimersByTime(10000);
    expect(player.index).toBe(1);
    expect(player.playing).toBe(false);
    expect(render).toHaveBeenLastCalledWith(1, false);
  });

  it("ne démarre pas une séquence vide ou composée d'une seule année", () => {
    const player = new TimelinePlayer(vi.fn(), vi.fn());
    player.play();
    expect(player.playing).toBe(false);
    player.setLength(1);
    player.play();
    expect(player.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("anime les déplacements manuels sans poursuivre la lecture automatique", () => {
    const render = vi.fn();
    const player = new TimelinePlayer(render, vi.fn());
    player.setLength(5);
    player.play();
    player.seek(1, true);
    expect(render).toHaveBeenLastCalledWith(1, true);
    expect(player.playing).toBe(false);
    player.seek(0, true);
    expect(render).toHaveBeenLastCalledWith(0, true);
    vi.advanceTimersByTime(10000);
    expect(player.index).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("avance continuellement dès le lancement et reprend à la position exacte après une pause", () => {
    const render = vi.fn();
    const progress = vi.fn();
    const player = new TimelinePlayer(render, vi.fn(), progress);
    player.setLength(3);
    player.play();
    vi.advanceTimersByTime(375);
    expect(player.position).toBeGreaterThan(0.2);
    expect(player.position).toBeLessThan(0.3);
    expect(progress.mock.calls.length).toBeGreaterThan(10);
    player.pause();
    expect(player.position).toBe(0.25);
    vi.advanceTimersByTime(5000);
    expect(player.position).toBe(0.25);
    player.play();
    expect(render).toHaveBeenLastCalledWith(1, true, 1125);
    player.pause();
  });

  it("change la vitesse sans reculer ou remettre la progression à zéro", () => {
    const player = new TimelinePlayer(vi.fn(), vi.fn());
    player.setLength(5);
    player.play();
    vi.advanceTimersByTime(750);
    player.setInterval(750);
    expect(player.position).toBe(0.5);
    vi.advanceTimersByTime(375);
    expect(player.position).toBe(1);
    player.pause();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("traverse une année absente sans saut de position ni accélération", () => {
    const render = vi.fn();
    const player = new TimelinePlayer(render, vi.fn());
    player.setLength(2, 0, [1992, 1994]);
    player.play();
    expect(render).toHaveBeenLastCalledWith(1, true, 3000);
    vi.advanceTimersByTime(1500);
    player.pause();
    expect(player.position).toBe(1993);
    player.play();
    expect(render).toHaveBeenLastCalledWith(1, true, 1500);
    vi.advanceTimersByTime(1500);
    expect(player.position).toBe(1994);
    expect(player.playing).toBe(false);
  });
});
