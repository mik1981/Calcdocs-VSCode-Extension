import type { EvaluationContext } from "./evaluator";

export function createEvaluationContext(caseDir: string): EvaluationContext {

  const symbols = new Map<string, any>();

  return {
    resolveIdentifier: (name: string) => {
      return symbols.get(name);
    },

    // defineIdentifier: (name: string, value: any) => {
    //   symbols.set(name, value);
    // },

    // eventuali altri hook del tuo engine
  };
}