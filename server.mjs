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
  authorizationUser: "dragon",
  password: "firebreath123",
};

io.on("connection", (socket) => {
  console.log("🐉 Dragão conectado!");

  socket.on("register", async () => {
    const userAgent = new UserAgent(sipServerConfig);
    await userAgent.start();
    const registerer = new Registerer(userAgent);
    await registerer.register();

    socket.emit("registered", { message: "Registro SIP bem-sucedido!" });
  });

  socket.on("call", async (targetDragon) => {
    const userAgent = new UserAgent(sipServerConfig);
    await userAgent.start();

    const session = await userAgent.invite(`sip:${targetDragon}@example.com`);

    session.on("accepted", () => {
      socket.emit("callAccepted", { message: "Chamada aceita!" });
    });

    session.on("terminated", () => {
      socket.emit("callEnded", { message: "Chamada encerrada!" });
    });
  });

  socket.on("disconnect", () => {
    console.log("🐉 Dragão desconectado!");
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
