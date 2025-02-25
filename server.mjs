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


const sipServerConfig = {
  transportOptions: {
    wsServers: "SERVIDOR_SIP_AQUI",
  },
  uri: "sip:dragon@example.com",
  authorizationUser: "LOGIN",
  password: "SENHA",
};

io.on("connection", (socket) => {
  console.log("🐉 Dragão conectado!");
  

  let userAgent;
  let registerer;
  let session;


  socket.on("register", async () => {
    try {
      userAgent = new UserAgent(sipServerConfig);
      await userAgent.start();
      registerer = new Registerer(userAgent);
      await registerer.register();
      socket.emit("registered", { message: "Registro SIP bem-sucedido!" });
    } catch (error) {
      console.error("Erro no registro SIP:", error);
      socket.emit("registrationError", { error: error.toString() });
    }
  });

  // Inicia uma chamada SIP
  socket.on("call", async (targetDragon) => {
    try {
      if (!userAgent) {
        socket.emit("callError", { error: "UserAgent não iniciado. Registre primeiro." });
        return;
      }
      // Inicia a chamada com restrições de áudio (WebRTC)
      session = await userAgent.invite(`sip:${targetDragon}@example.com`, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });
      session.on("accepted", () => {
        socket.emit("callAccepted", { message: "Chamada aceita!" });
      });
      session.on("terminated", () => {
        socket.emit("callEnded", { message: "Chamada encerrada!" });
        session = null;
      });
    } catch (error) {
      console.error("Erro na chamada SIP:", error);
      socket.emit("callError", { error: error.toString() });
    }
  });

  // Encerra a chamada
  socket.on("hangup", () => {
    if (session) {
      session.bye();
      session = null;
    }
  });

  // Ao desconectar, encerra sessões e limpa recursos
  socket.on("disconnect", async () => {
    console.log("🐉 Dragão desconectado!");
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
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
