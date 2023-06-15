//some code from wiki
// Require the packages we will use:
const http = require("http"),
    fs = require("fs");

const port = 3456;
const file = "client.html";
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html, on port 3456:
const server = http.createServer(function (req, res) {
    // This callback runs when a new connection is made to our HTTP server.

    fs.readFile(file, function (err, data) {
        // This callback runs when the client.html file has been read from the filesystem.

        if (err) return res.writeHead(500);
        res.writeHead(200);
        res.end(data);
    });
});
server.listen(port);

// Import Socket.IO and pass our HTTP server object to it.
const socketio = require("socket.io")(http, {
    wsEngine: 'ws'
});

let users = [];
let usersInfo = [];
let rooms = [];
let logUsers = [];

let User = function (username, password, socketId) {
    this.username = username; 
    this.password = password; 
    this.socketId = socketId; 
    this.rooms = [];    
}
let Room = function (roomName, host, password) {
    this.roomName = roomName; 
    this.host = host;         
    this.password = password; 
    this.users = [];          
    this.chatLog = [];       
    this.banList = [];
}

// Attach our Socket.IO server to our HTTP server to listen
const io = socketio.listen(server);
io.sockets.on("connection", function (socket) {
    socket.on("disconnect", function (data) {
        console.log(socket.username);
        if (socket.username != undefined) {
            logUsers.splice(logUsers.indexOf(socket.username), 1);
        }
    });

    socket.on("logout_user_to_server", function (data) {
        console.log("Logout attempt from: " + socket.username);
        // User should exist
        if (socket.username != undefined) {
            logUsers.splice(logUsers.indexOf(socket.username), 1);

            socket.leave(socket.room)
            socket.room = null;
            socket.emit("logoutSuccess", "");
        }
        else {
            socket.emit("logoutFail", "");
        }
    });


    // When log in new user
    socket.on("login_user_to_server", function (data) {
        if (!users.includes(data.user)) {
            socket.emit("loginFail", { result: "inv_user" });
        }
        else if (data.user == "") {
            socket.emit("loginFail", { result: "emp_user" });
        }
        else if (data.pass == "") {
            socket.emit("loginFail", { result: "emp_pass" });
        }
        else {
            socket.username = data.user;

            // If the password is correct
            let pass = usersInfo.find(x => x.username == data.user);
            if (pass.password != data.pass) {
                socket.emit("loginFail", { result: "inv_pass" });
            }
            else if (logUsers.includes(pass)) {
                socket.emit("loginFail", { result: "dup_user" });
            }
            else {
                logUsers.push(pass);
                socket.emit("updateRoomList", rooms);
                socket.emit("loginSuccess", { user: data.user });
            }
        }
    });

    // When register
    socket.on("new_user_to_server", function (data) {
        if (users.includes(data.user)) {
            socket.emit("registerFail", { result: "dup" });
        }
        else if (data.user == "") {
            socket.emit("registerFail", { result: "emp_user" });
        }
        else if (data.pass == "") {
            socket.emit("registerFail", { result: "emp_pass" });
        }
        else {
            socket.username = data.user;
            socket.password = data.pass;
            socket.room = null;
            let newUser = new User(data.user, data.pass, socket.id);

            users.push(data["user"]);
            usersInfo.push(newUser);
            socket.emit("registerSuccess", rooms);
        }
    });

    //Request for a chat room
    socket.on('room_request_to_server', function (data) {
        console.log("Creating room: " + data["roomTitle"]);
        if (data["roomTitle"] == "") {
            socket.emit("emptyRoomName", "");
        }
        else {
            let exist = rooms.find(x => x.roomName == data["roomTitle"]);
            if (exist) {
                socket.emit("existingRoom", "");
            }
            else {
                let user = data["user"];
                let name = data["roomTitle"];
                let pwd = data["roomPassword"];
                let new_room = new Room(name, user, pwd, []);
                new_room.users.push(user);
                rooms.push(new_room);

                let host = usersInfo.find(x => x.username == data.user);
                host.rooms.push(new_room);

                socket.emit("update_host_rooms", host.rooms);
                socket.emit("create_success", "");

                io.sockets.emit("updateRoomList", rooms);
            }
        }
    });

    socket.on('join_room_request_to_server', function (data) {
        for (let i = 0; i < rooms.length; ++i) {
            if (data["roomData"] == rooms[i].roomName) {
                console.log("banned: " + rooms[i].banList);
                socket.room = rooms[i];
                if (!(rooms[i].users.includes(socket.username))) {
                    rooms[i].users.push(socket.username);
                }
                socket.join(data["roomData"]);
                io.in(socket.room.roomName).emit("roomusers", socket.room);
                io.sockets.emit("updateRoomList", rooms);

                socket.emit("update_chat_room", socket.room.chatLog);
            }
        }
    });

    socket.on('message_to_server', function (data) {
        console.log("user: " + data["user"]);
        console.log("message: " + data["message"]); 
        console.log("room: " + data["roomInfo"]); 
        let room = rooms.find(x => x.roomName == data["roomInfo"]);
        room.chatLog.push([data["user"], "public", data["message"]]);

        io.in(data["roomInfo"]).emit("message_to_client", { user: data["user"], message: data["message"] }) // broadcast the message to other users
    });

    socket.on('private_message', function (data) {
        let sender = data["send"];
        let recipient = data["receive"];
        let curr_room = data["room"];
        let msg = data["pm"];

        console.log(sender + "to " + recipient + " in " + curr_room.roomName + " about " + msg);
        let room = rooms.find(x => x.roomName == curr_room.roomName);
        room.chatLog.push([sender, recipient, msg]);
        console.log(room.chatLog);
        io.in(data["room"].roomName).emit("update_chat_room", room.chatLog);

    });


    socket.on("leave_request_to_server", function (data) {
        for (let i = 0; i < rooms.length; ++i) {
            if (rooms[i].roomName == data["room"]) {
                socket.room = null;
                rooms[i].users.splice(rooms[i].users.indexOf(socket.username), 1);
                io.in(data["room"]).emit("roomusers", rooms[i]);
            }
        }
        socket.leave(data["room"]);
        io.sockets.emit("updateRoomList", rooms);
    });

    //Delete chat room
    socket.on("delete_request_to_server", function (data) {
        let room = rooms.find(x => x.roomName == data["room"]);
        let host = usersInfo.find(x => x.username == data.user);
        while (room.users.length > 0) {
            let user = room.users[0];

            let info = usersInfo.find(x => x.username == user);
            let id = info.socketId;

            io.to(id).emit('userKick', room);
            room.users.splice(0, 1);
        }
        rooms.splice(rooms.indexOf(room), 1);
        host.rooms.splice(host.rooms.indexOf(data["room"]), 1);

        io.sockets.emit("updateRoomList", rooms);
        socket.emit("update_host_rooms", host.rooms);
        socket.emit("delete_success", "");
    });

    // Kick user from chat room
    socket.on("kick_request_to_server", function (data) {
        let kickedUser = data["kick"];
        let kickedRoom = data["room"];
        let kickedUserID = null;

        for (let i = 0; i < usersInfo.length; i++) {
            if (usersInfo[i].username == kickedUser) {
                kickedUserID = usersInfo[i].socketId;
            }
        }
        io.to(kickedUserID).emit('userKick', kickedRoom);

        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].roomName == data.roomName) {
                rooms[i].users.splice(rooms[i].users.indexOf(kickedUser), 1);
            }
        }

        io.in(socket.room.roomName).emit("roomusers", socket.room);
    });

    socket.on("ban_request_to_server", function (data) {
        let banUser = data["ban"];
        let banRoom = data["room"];
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].roomName == banRoom.roomName) {
                rooms[i].banList.push(banUser);
            }
        }
        if (banRoom.users.includes(banUser)) {
            let bannedUserID = null;
            for (let i = 0; i < usersInfo.length; i++) {
                if (usersInfo[i].username == banUser) {
                    bannedUserID = usersInfo[i].socketId;
                }
            }
            io.to(bannedUserID).emit('userKick', banRoom);
            for (let i = 0; i < rooms.length; i++) {
                if (rooms[i].roomName == data.roomName) {
                    rooms[i].users.splice(rooms[i].users.indexOf(banUser), 1);
                }
            }
            io.in(socket.room.roomName).emit("roomusers", socket.room);
        }
    });
});
