module.exports = {
  LOCAL: {
    token: "fixture-token",
  },
  MAP: {
    fixture_key: "fixture-value",
  },
  ACCOUNT: {
    ptjy: {
      USERNAME: "fixture-user",
      PASSWORD: "fixture-password",
    },
  },
  SERVER: {
    BINDHOST: "127.0.0.1",
    PORT: 83,
    TIMEOUTMS: 4500,
    LOGGINGENABLED: true,
    UNKNOWN: "server-preserved",
  },
  CACHE: {
    UNKNOWN: { value: "cache-preserved" },
  },
  CONIFG: {
    "/reqxml": { TARGET: "http://127.0.0.1:9100" },
    "/qdymanage": {
      TARGET: "https://fixture.example.test/manage",
      UNKNOWN_RULE: "rule-preserved",
    },
  },
  unknownFixtureField: "preserve-me",
};
