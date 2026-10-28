/**
 * Le nom du cache du service worker suit le build (dette n° 4bis). Sans base :
 * ce test tourne dans un `npm test` nu, et échoue si le nom redevient une
 * constante écrite à la main.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { stampServiceWorker } from '../vite.config.ts';

const source = readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8');

function build(index: string): string {
  const dist = mkdtempSync(join(tmpdir(), 'tablee-sw-'));
  writeFileSync(join(dist, 'sw.js'), source);
  writeFileSync(join(dist, 'index.html'), index);
  stampServiceWorker(dist);
  const cache = /const CACHE = '([^']+)'/.exec(readFileSync(join(dist, 'sw.js'), 'utf8'))?.[1];
  assert.ok(cache, 'constante CACHE introuvable dans sw.js');
  return cache;
}

describe('version du cache du service worker', () => {
  it('sw.js porte le marqueur que le build remplace, pas un nom fixe', () => {
    assert.match(source, /const CACHE = 'tablee-__BUILD__';/);
  });

  it('deux fronts différents donnent deux noms, deux fronts identiques le même', () => {
    const a = build('<script src="/assets/index-AAAA.js"></script>');
    const b = build('<script src="/assets/index-BBBB.js"></script>');
    assert.notEqual(a, b);
    assert.equal(build('<script src="/assets/index-AAAA.js"></script>'), a);
    assert.ok(!a.includes('__BUILD__'));
  });

  it("l'activation efface tout cache qui ne porte pas le nom courant", () => {
    assert.match(source, /addEventListener\('activate'[\s\S]*?filter\(\(k\) => k !== CACHE\)[\s\S]*?caches\.delete\(k\)/);
  });
});
