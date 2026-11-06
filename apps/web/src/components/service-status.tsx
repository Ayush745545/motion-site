"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Check, RefreshCw } from "lucide-react";
import { HealthResponseSchema, ReadyResponseSchema, type HealthResponse } from "@motion-dna/dna-schema";
import { Button } from "@/components/ui/button";

type Connection = { health: HealthResponse | null; database: boolean; loading: boolean; checkedAt: string | null };
const initial: Connection = { health: null, database: false, loading: true, checkedAt: null };

export function ServiceStatus() {
  const [connection, setConnection] = useState(initial);

  const check = useCallback(async (signal?: AbortSignal): Promise<Connection | undefined> => {
    const read = async (path: string) => {
      const timeout = AbortSignal.timeout(6000);
      const response = await fetch(path, {
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error("unavailable");
      return response.json() as Promise<unknown>;
    };
    const [health, ready] = await Promise.allSettled([
      read("/api/health").then((data) => HealthResponseSchema.parse(data)),
      read("/api/ready").then((data) => ReadyResponseSchema.parse(data)),
    ]);
    if (signal?.aborted) return;
    return {
      health: health.status === "fulfilled" ? health.value : null,
      database: ready.status === "fulfilled",
      loading: false,
      checkedAt: new Date().toLocaleTimeString(),
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      void check(controller.signal).then((result) => {
        if (result) setConnection(result);
      });
    };
    update();
    const interval = setInterval(update, 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [check]);

  const online = Boolean(connection.health);

  return <section className="panel service-panel"><div className="section-heading"><div><h2>Local services</h2><p>Everything your studio needs to keep moving.</p></div><span className={`status-label ${online?"status-online":""}`}>{connection.loading?"Checking services…":online?"API connected":"API offline"}</span></div><div className="service-rows">{[{title:"Web interface",detail:"Next.js · React",good:true,status:"Active"},{title:"API service",detail:"FastAPI · Python",good:online,status:online?"Connected":"Unavailable"},{title:"Database",detail:"PostgreSQL · Local",good:connection.database,status:connection.database?"Connected":"Unavailable"}].map(item=><div className="service" key={item.title}><span className={`service-icon ${item.good?"is-online":""}`}>{item.good?<Check size={14}/>:<Activity size={14}/>}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><span>{connection.loading&&item.title!=="Web interface"?"…":item.status}</span></div>)}</div>
   {!connection.loading&&(!online||!connection.database)&&<p className="service-help" role="status">{!online?"Start the local API with pnpm dev:api, then check the connection again.":"The API is running. Start PostgreSQL with pnpm db:up or pnpm db:native:up to connect the database."}</p>}
   <div className="service-footer"><span>{connection.checkedAt?`Last checked ${connection.checkedAt}`:"Checking services…"}{connection.health&&` · API v${connection.health.version}`}</span><Button variant="outline" size="sm" disabled={connection.loading} onClick={()=>{setConnection(value=>({...value,loading:true}));void check().then(result=>{if(result)setConnection(result);});}}><RefreshCw size={13} className={connection.loading?"spinning":""}/>{connection.loading?"Checking…":"Check connection"}</Button></div>
  </section>;
}
