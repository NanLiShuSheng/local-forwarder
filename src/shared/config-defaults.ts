import type { AppConfig } from "./contracts";

export const DEFAULT_REQUEST_HOST = "123.103.83.82";
export const DEFAULT_REQUEST_PORT = 6064;

export const DEFAULT_REQUEST_PARAMS_TEXT = [
  "Action=100",
  "account=600554432",
  "password=600000",
  ";password=123321",
  "compassword=111111",
  "MobileCode=17000000000",
  "accounttype=zjaccount",
  ";accounttype=khbh",
  "MobileType=2",
  "ReqlinkType=2",
  "Cfrom=zxzq.iphone",
  "TFrom=iphone",
  "maxcount=1",
].join("\n");

export function createDefaultForwardingTargets(): AppConfig["tcpTargets"] {
  return [
    { id: "tcp-1", name: "hq", host: "60.12.9.58", port: 7778, protocol: "http", transport: "http", enabled: true },
    { id: "tcp-2", name: "jy", host: "123.103.83.82", port: 6064, enabled: true },
    { id: "tcp-3", name: "zx", host: "123.103.83.82", port: 6064, enabled: true },
  ];
}
