module.exports = {
  SERVER: {
    BINDHOST: "127.0.0.1",
    PORT: 83,
    TIMEOUTMS: 4500,
    LOGGINGENABLED: true,
  },
  LOCALVALUES: {
    token: "fixture-token",
  },
  MAPVALUES: {
    fixture_key: "fixture-value",
  },
  ACCOUNTS: {
    ptjy: {
      USERNAME: "fixture-user",
      PASSWORD: "fixture-password",
    },
  },
  CONIFG: {
    "/reqxml": { TARGET: "http://127.0.0.1:9100" },
    "/qdymanage": { TARGET: "https://fixture.example.test/manage" },
  },
  unknownFixtureField: "preserve-me",
};
