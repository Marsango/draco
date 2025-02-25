import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { UserAgent, Registerer } from "sip.js";
import WebSocket from "ws";
global.WebSocket = WebSocket;
import cors from "cors";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
  },
});

// cabeçalho contendo os dados necessarios pra conectar no servidor sip
const sipServerConfig = {
  transportOptions: {
    wsServers: "SERVIDOR_SIP_AQUI",
  },
  uri: "sip:dragon@example.com",
  authorizationUser: "LOGIN",
  password: "SENHA",
};

io.on("connection", (socket) => {
  // quando um dragao se conecta registra no console
  console.log("🐉 dragao conectado!");

  let userAgent;
  let registerer;
  let session;
  let qosMonitorInterval;

  // funcao para modificar o sdp e limitar a banda de video e audio
  function modifySdpBandwidth(sdp) {
    const lines = sdp.split("\n");
    let modifiedLines = [];
    for (let line of lines) {
      // se for a linha de video a gente insere uma linha pra limitar a banda a 256 kbps
      if (line.startsWith("m=video")) {
        modifiedLines.push(line);
        modifiedLines.push("b=AS:256");
      }
      // se for a linha de audio definimos 128 kbps
      else if (line.startsWith("m=audio")) {
        modifiedLines.push(line);
        modifiedLines.push("b=AS:128");
      } else {
        modifiedLines.push(line);
      }
    }
    return modifiedLines.join("\n");
  }

  // funcao que inicia o monitoramento de qos
  // verificamos periodicamente se a perda de pacotes e o rtt estao dentro dos limites
  function startQoSMonitor() {
    qosMonitorInterval = setInterval(() => {
      if (
        session &&
        session.sessionDescriptionHandler &&
        session.sessionDescriptionHandler.peerConnection
      ) {
        session.sessionDescriptionHandler.peerConnection
          .getStats(null)
          .then((stats) => {
            let audioStats = { packetLoss: 0, rtt: 0 };
            let videoStats = { packetLoss: 0, rtt: 0 };

            stats.forEach((report) => {
              // verificando estatisticas de pacotes do audio e do video
              if (report.type === "inbound-rtp") {
                if (report.kind === "audio") {
                  const packetsLost = report.packetsLost || 0;
                  const packetsReceived = report.packetsReceived || 0;
                  const totalPackets = packetsLost + packetsReceived;
                  audioStats.packetLoss =
                    totalPackets > 0 ? packetsLost / totalPackets : 0;
                } else if (report.kind === "video") {
                  const packetsLost = report.packetsLost || 0;
                  const packetsReceived = report.packetsReceived || 0;
                  const totalPackets = packetsLost + packetsReceived;
                  videoStats.packetLoss =
                    totalPackets > 0 ? packetsLost / totalPackets : 0;
                }
              }
              // pegando o rtt da conexao se tiver informacao disponivel
              if (
                report.type === "candidate-pair" &&
                report.state === "succeeded" &&
                report.selected
              ) {
                if (report.currentRoundTripTime) {
                  // convertendo de segundos pra milissegundos
                  audioStats.rtt = report.currentRoundTripTime * 1000;
                  videoStats.rtt = report.currentRoundTripTime * 1000;
                }
              }
            });

            // se o audio tiver mais de 5% de perda ou rtt acima de 150 ms emite um aviso
            if (audioStats.packetLoss > 0.05 || audioStats.rtt > 150) {
              socket.emit("qosWarning", {
                type: "audio",
                packetLoss: audioStats.packetLoss,
                rtt: audioStats.rtt,
              });
            }
            // se o video tiver mais de 5% de perda ou rtt acima de 250 ms emite um aviso
            if (videoStats.packetLoss > 0.05 || videoStats.rtt > 250) {
              socket.emit("qosWarning", {
                type: "video",
                packetLoss: videoStats.packetLoss,
                rtt: videoStats.rtt,
              });
            }
          })
          .catch((err) => console.error("erro ao obter estatisticas", err));
      }
    }, 5000); // verifica a cada 5 segundos
  }

  // funcao pra parar o monitoramento de qos
  function stopQoSMonitor() {
    if (qosMonitorInterval) {
      clearInterval(qosMonitorInterval);
      qosMonitorInterval = null;
    }
  }

  // evento para registrar o dragao no servidor sip
  // cria um useragent e registerer pra fazer o registro sip
  socket.on("register", async () => {
    try {
      userAgent = new UserAgent(sipServerConfig);
      await userAgent.start();
      registerer = new Registerer(userAgent);
      await registerer.register();
      socket.emit("registered", { message: "registro sip bem-sucedido!" });
    } catch (error) {
      console.error("erro no registro sip", error);
      socket.emit("registrationError", { error: error.toString() });
    }
  });

  // evento para iniciar uma chamada sip com audio e video
  // usa o modificador do sdp pra limitar a banda do video e priorizar o audio
  socket.on("call", async (targetDragon) => {
    try {
      if (!userAgent) {
        socket.emit("callError", {
          error: "useragent nao iniciado registra primeiro",
        });
        return;
      }
      session = await userAgent.invite(`sip:${targetDragon}@example.com`, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: true },
          sessionDescriptionHandlerModifiers: [modifySdpBandwidth],
        },
      });
      // quando a chamada for aceita inicia o monitoramento de qos
      session.on("accepted", () => {
        socket.emit("callAccepted", { message: "chamada aceita!" });
        startQoSMonitor();
      });
      // quando a chamada terminar para o monitoramento de qos e limpa a sessao
      session.on("terminated", () => {
        socket.emit("callEnded", { message: "chamada encerrada!" });
        stopQoSMonitor();
        session = null;
      });
    } catch (error) {
      console.error("erro na chamada sip", error);
      socket.emit("callError", { error: error.toString() });
    }
  });

  // evento para encerrar a chamada
  // envia um bye e para o monitoramento de qos
  socket.on("hangup", () => {
    if (session) {
      session.bye();
      stopQoSMonitor();
      session = null;
    }
  });

  // quando o dragao desconectar encerra a sessao e limpa os recursos
  socket.on("disconnect", async () => {
    console.log("🐉 dragao desconectado!");
    if (session) {
      session.bye();
    }
    if (registerer) {
      await registerer.unregister();
    }
    if (userAgent && userAgent.isStarted) {
      userAgent.stop();
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🔥 servidor rodando na porta ${PORT}`);
});
