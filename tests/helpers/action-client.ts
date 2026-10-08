import type { PGlite } from "@electric-sql/pglite";
import { ACCOUNT, asAccount, rpc } from "./database";

export function actionClient(db: PGlite) {
  const controls: {
    loseResponse: boolean;
    failRecovery: boolean;
    beforeUpload: () => Promise<void>;
    beforeRpc: (name: string, args: Record<string, unknown>) => Promise<void>;
  } = {
    loseResponse: false,
    failRecovery: false,
    beforeUpload: async () => {},
    beforeRpc: async () => {},
  };
  const client = {
    auth: { signOut: async () => ({ error: null }) },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      await controls.beforeRpc(name, args);
      if (name === "get_recipe" && controls.failRecovery) throw new TypeError("offline");
      try {
        const data = await rpc(db, ACCOUNT, name, args);
        if (name === "save_recipe" && controls.loseResponse) {
          controls.loseResponse = false;
          return { data: null, error: new TypeError("response lost after commit") };
        }
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          await controls.beforeUpload();
          await asAccount(db, ACCOUNT, (tx) =>
            tx.query("insert into storage.objects(bucket_id, name) values ('recipe-photos', $1)", [
              path,
            ]),
          );
          return { error: null };
        },
        remove: async (paths: string[]) => {
          await asAccount(db, ACCOUNT, (tx) =>
            tx.query(
              "delete from storage.objects where bucket_id = 'recipe-photos' and name = any($1::text[])",
              [paths],
            ),
          );
          return { error: null };
        },
      }),
    },
  };
  return { client, controls };
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
