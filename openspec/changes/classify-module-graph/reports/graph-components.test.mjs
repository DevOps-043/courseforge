import assert from 'node:assert/strict';
import test from 'node:test';
import { cyclicComponents } from './graph-components.mjs';

test('incluye recorridos alternativos en la misma componente', () => {
  assert.deepEqual(cyclicComponents({ a: ['b', 'c'], b: ['a'], c: ['b'], leaf: ['a'] }), [['a', 'b', 'c']]);
});
test('separa componentes conectadas en una sola dirección', () => {
  assert.deepEqual(cyclicComponents({ a: ['b'], b: ['a', 'c'], c: ['d'], d: ['c'] }), [['a', 'b'], ['c', 'd']]);
});
test('un nodo aislado no es ciclo; una autorreferencia sí', () => {
  assert.deepEqual(cyclicComponents({ isolated: [], self: ['self'] }), [['self']]);
});
test('no inventa ciclos en dependencias sin entradas o grafos vacíos', () => {
  assert.deepEqual(cyclicComponents({ a: ['external'] }), []);
  assert.deepEqual(cyclicComponents({}), []);
});
