// Compatibilidade do leitor de PDF (pdf.js) com o Safari do iPhone.
// O pdf.js percorre streams com "for await (... of stream)", e o Safari ainda não permite iterar um ReadableStream.
// Aqui o recurso é acrescentado quando falta. Carregado antes do pdf.js, no app e no worker (pdf-worker.mjs).
const RS = globalThis.ReadableStream;
if (RS && !RS.prototype[Symbol.asyncIterator]) {
  RS.prototype.values = function values({ preventCancel = false } = {}) {
    const leitor = this.getReader();
    return {
      async next() {
        try {
          const r = await leitor.read();
          if (r.done) leitor.releaseLock();
          return r;
        } catch (e) { leitor.releaseLock(); throw e; }
      },
      async return(valor) {
        if (!preventCancel) { const c = leitor.cancel(valor); leitor.releaseLock(); await c; } else leitor.releaseLock();
        return { done: true, value: valor };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  RS.prototype[Symbol.asyncIterator] = RS.prototype.values;
}
