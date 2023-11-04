const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const querystring = require("querystring");
const { v4: uuidv4 } = require('uuid');
const { sign } = require('jsonwebtoken');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const mysql = require('mysql2/promise');
const MySQLStore = require('express-mysql-session')(session);
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8081;

let tickerData = [];
let marketDataK = [];
let marketEnglishName = [];
const sdk = require('api')('@upbit/v1.4.0#1h2zv2al3jq48nm');
//let access_key = 'sFaMyo6Pm7RuIwzkC6pvPxp08HRPfBS12UvDnS2W';
//let secret_key = 'xK4LGsNoVC5u7YsCM9c93ahzIsRgYNC3R8VN93gG';
let access_key = 'gMqeMhVlCiajImnYb52fSUEYzVCa5Wx8hYLZtvNU';
let secret_key = 'EUdnSLC07voERTxgpR0xjmhReTtSrajDpstY7oxd';
server_url = 'https://api.upbit.com';
app.use(bodyParser.urlencoded({ extended: true }));
let coinname2Value = ''; // 전역 변 수로 설정
app.use(bodyParser.json())
let image_id;
async function createMysqlConnection() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });
    return connection;
  } catch (error) {
    console.error('MySQL connection error:', error);
    throw error;
  }
}
// 32바이트 길이의 무작위한 문자열 생성
const generateRandomKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

const secretKey = generateRandomKey();
console.log('Generated secret key:', secretKey);
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});
app.use(session({
  secret: secretKey,
  resave: false,
  saveUninitialized: true,
}));

const sessionStore = new MySQLStore({
  // MySQL 연결 정보 설정
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'mydatabase',
});

app.use(session({
  secret: secretKey, // 비밀 키
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
}));
const wss = new WebSocket.Server({ port: 8082 });
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});


function sendAccountDataToClient(accountData) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'accountData', data: accountData }));
    }
  });
}

function updateAndSendAccountData() {
  const payload = {
    access_key: access_key,
    nonce: uuidv4(),
  };
  const token = sign(payload, secret_key);
  const accountOptions = {
    method: 'GET',
    url: server_url + '/v1/accounts',
    headers: { Authorization: `Bearer ${token}` },
  };
  axios(accountOptions)
    .then(accountResponse => {
      const jsonData = accountResponse.data;
      const formattedValues = jsonData.map(obj => Object.values(obj));
      sendAccountDataToClient(formattedValues);
    })
    .catch(error => {
      console.error('api key err:', error);
    });
}
const updateInterval2 = 1000;
const updateIntervalId2 = setInterval(updateAndSendAccountData, updateInterval2);
function sendPriceDataToClient() {
  const marketData = tickerData.map((ticker, index) => {
    return {
      market: marketDataK[index].market,
      english_name: marketEnglishName[index],
      trade_price: ticker.trade_price,
      high_price: ticker.high_price,
      low_price: ticker.low_price,
      prev_closing_price: ticker.prev_closing_price,
      signed_change_price : ticker.signed_change_price,
      signed_change_rate : ticker.signed_change_rate,
    };
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(marketData));
    }
  });
}
const updateInterval = 1000;
const updateIntervalId = setInterval(() => {
  axios.get('https://api.upbit.com/v1/ticker', {
    params: {
      markets: marketDataK.map(item => item.market).join(',')
    },
    headers: {
      'Accept': 'application/json'
    }
  })
  .then(tickerResponse => {
    tickerData = tickerResponse.data; 
    sendPriceDataToClient(); 
  })
  .catch(error => {
   // console.error('Error fetching ticker data:', error);
  });
}, updateInterval);

process.on('SIGINT', () => {
  clearInterval(updateIntervalId);
  process.exit();
});
app.get('/', (req, res) => {
  res.render('main', { }); // 메인 페이지 랜더링
});
app.get('/exchange', (req, res) => {
  const user_id = req.session.user_id; // 세션에서 user_id 가져오기
  if (!user_id) {
    return res.redirect('/user/login');
  }
  const payload = {
    access_key: access_key,
    nonce: uuidv4(),
  };
  const token = sign(payload, secret_key);

  const accountOptions = {
    method: 'GET',
    url: server_url + '/v1/accounts',
    headers: { Authorization: `Bearer ${token}` },
  };
  axios(accountOptions)
    .then(accountResponse => {
      const jsonData = accountResponse.data;
      const formattedValues = jsonData.map(obj => Object.values(obj));

      const marketOptions = {
        method: 'GET',
        url: `${server_url}/v1/market/all?isDetails=false`
      };

      axios(marketOptions)
        .then(marketResponse => {
          const marketData = marketResponse.data;
          marketDataK = marketData.filter(item => item.market.startsWith('K'));
          marketEnglishName = marketDataK.map(item => item.english_name);

          processRemainingLogic(formattedValues, marketDataK, marketEnglishName, res);
        })
        .catch(error => {
          console.error(error);
          res.status(500).send('Error fetching market data');
        });
    })
    .catch(error => {
      console.error('Error fetching account data:', error);
      res.status(500).send('API KEY ERROR');
    });
});


//여기
app.post('/sendCoinName', (req, res) => {
  const coinname2Value = req.body.coinname2;
  //console.log('Received coinname2 from client: ' + coinname2Value);
  app.locals.coinname2 = coinname2Value;
  res.json({ message: 'Received coinname2 on the server.' });
});


app.get('/chart', async (req, res) => {
  const minutes = req.query.minutes || 1;
  const coinname2 = app.locals.coinname2 ||'KRW-BTC'; // coinname2 값을 받아옴
  const count = 200;
  console.log("Received coinname2 from client: " + coinname2, minutes, coinname2Value);
  try {
      const apiUrl = `https://api.upbit.com/v1/candles/minutes/${minutes}`;
      const response = await axios.get(apiUrl, {
          params: {
              market: coinname2, // market 대신 coinname2 사용
              count,
          },
      });
      const chartData = response.data;
      res.json({ chartData });
  } catch (error) {
      console.error(error);
      res.status(500).send('Error fetching data from API');
  }
});

function processRemainingLogic(formattedValues, marketDataK, marketEnglishName, res) {
  const tickerOptions = {
    method: 'GET',
    url: 'https://api.upbit.com/v1/ticker',
    params: {
      markets: marketDataK.map(item => item.market).join(',')
    },
    headers: {
      'Accept': 'application/json'
    }
  };
  axios(tickerOptions)
    .then(tickerResponse => {
      tickerData = tickerResponse.data;
      const insertCoinData = () => {
        const currentTime = new Date();
        const values = marketDataK.map((item, index) => {
          const ticker = tickerData.find(data => data.market === item.market);
          const price = ticker ? ticker.trade_price : null;
          const coinName = marketEnglishName[index] === "Bitcoin" ? "Bitcoin" : null;
          if (coinName !== null) {
            return [coinName, currentTime, price];
          }
        });
        const filteredValues = values.filter(value => value !== undefined);
        if (filteredValues.length === 0) {
          console.log('No data to insert');
          return;
        }
        // const query = 'INSERT INTO coin_data (coin_name, timestamp, price) VALUES ?';
        // connection.query(query, [filteredValues], (err, result) => {
        //   if (err) {
        //     console.error('Error inserting coin_data:', err);
        //     return res.status(500).send('Error inserting coin_data');
        //   }
        //   console.log('Successfully inserted coin_data');

        //   const selectQuery = 'SELECT timestamp, price FROM coin_data WHERE coin_name = ?';
        //   connection.query(selectQuery, ['Bitcoin'], (err, rows) => {
        //     if (err) {
        //       console.error('Error selecting coin_data:', err);
        //       return res.status(500).send('Error selecting coin_data');
        //     }
        //     const chartData = rows.map(row => ({
        //       timestamp: row.timestamp,
        //       price: row.price
        //     }));
        res.render('exchange', { formattedValues, marketDataK, marketEnglishName, tickerData });
       // res.render('mypage', { formattedValues, marketDataK, marketEnglishName, tickerData });
        //   });
        // });
      };
      insertCoinData();
    })
    .catch(error => {
      console.error(error);
      res.status(500).send('Error fetching ticker data');
    });
}
app.post('/place-order', (req, res) => {
  const market = 'KRW-' + req.body.ordercoin; // 거래하고자 하는 마켓
  console.log(market);
  const side = 'bid'; // 주문 종류: 매수
  const price = req.body.price
  const ordType = 'price'; // 주문 타입: 시장가 매수
  console.log("sss"+market)
  const body = {
    market: market,
    side: side,
    price: price,
    ord_type: ordType
  };
  const query = querystring.encode(body);
  const hash = crypto.createHash('sha512');
  const queryHash = hash.update(query, 'utf-8').digest('hex');
  const payload = {
    access_key: access_key,
    nonce: uuidv4(),
    query_hash: queryHash,
    query_hash_alg: 'SHA512',
  };
  const token = sign(payload, secret_key);
  const options = {
    method: 'POST',
    url: server_url + '/v1/orders',
    headers: { Authorization: `Bearer ${token}` },
    data: body
  };
  axios(options)
    .then(response => {
      console.log(response.data);
    })
    .catch(error => {
      console.error(error);
      res.status(500).send('Error placing order');
    });
});

//여기
app.get('/getBitcoinPrice', async (req, res) => {
  const bitcoinPrice = await getBitcoinPrice();
  res.json({ bit: bitcoinPrice });
});


app.post('/sell-order', (req, res) => {
  const market = 'KRW-' + req.body.sellcoin;
  console.log(market);
  const side = 'ask'; 
  const volume = req.body.volume; 
  const ordType = 'market'; 
  console.log("sss",market)
  const body = {
    market: market,
    side: side,
    volume: volume,
    ord_type: ordType
  };
  const query = querystring.encode(body);
  const hash = crypto.createHash('sha512');
  const queryHash = hash.update(query, 'utf-8').digest('hex');
  const payload = {
    access_key: access_key,
    nonce: uuidv4(),
    query_hash: queryHash,
    query_hash_alg: 'SHA512',
  };
  const token = sign(payload, secret_key);
  const options = {
    method: 'POST',
    url: server_url + '/v1/orders',
    headers: { Authorization: `Bearer ${token}` },
    data: body
  };
  axios(options)
    .then(response => {
      console.log(response.data);
    })
    .catch(error => {
      console.error(error);
      res.status(500).send('판매 주문을 실행하는 도중 오류가 발생했습니다.');
    });
});

async function getBitcoinPrice2() {
  try {
    const response = await axios.get('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
    return response.data[0].trade_price;
  } catch (error) {
    console.error('비트코인 가격을 가져오는 중 오류 발생:', error);
    return 'N/A';
  }
}

app.post('/paycoin2', async (req, res) => {
  const bitname = await getBitcoinPrice();
  const userid = req.body.userid;
  const price = req.body.price; 
    console.log("coinssss",bitname,price);
    try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });

    const query = `
      SELECT walletaddress
      FROM users
      WHERE user_id = ?
    `;

    const [results] = await mysqlConnection.execute(query, [userid]);
    await mysqlConnection.end(); // 연결 종료
    const walletaddress = results[0].walletaddress;
    console.log("유저아이디",walletaddress);
  } catch (error) {
    console.error('MySQL 연결 또는 쿼리 실행 오류:', error);
    return res.status(500).send('서버에서 오류가 발생했습니다.');
  }
  // const currency = "BTC"
  // const net_type = 'NETWORK'; // 출금 네트워크 종류
  // const amount = req.body.amount; // 금액l
  // const address = req.body.results;
  // const transaction_type = 'internal'; // 바로출금 선택
  // const body = {
  //     currency,
  //     net_type,
  //     amount,
  //     address,
  //     transaction_type,
  // };
  // const query = querystring.encode(body);
  // const hash = crypto.createHash('sha512');
  // const queryHash = hash.update(query, 'utf-8').digest('hex');
  // const payload = {
  //     access_key,
  //     nonce: new Date().getTime().toString(),
  //     query_hash: queryHash,
  //     query_hash_alg: 'SHA512',
  // };
  // const token = sign(payload, secret_key);
  // const options = {
  //     method: "POST",
  //     url: server_url + "/v1/withdraws/coin",
  //     headers: { Authorization: `Bearer ${token}` },
  //     data: body,
  // };
  // try {
  //     const response = await axios(options);
  //     res.render('result', { result: response.data });
  // } catch (error) {
  //     res.status(500).send('An error occurred');
  // }
});
let us='';
// 물품 이미지를 업로드하기 위한 Multer 설정 (수정 필요 -> path로 이미지를 불러오는 대신 base64를 이용해야 됨)
const upload = multer({ dest: 'uploads/' }); // 업로드된 파일 저장 디렉토리 설정
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = require('socket.io')(server);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true ,limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));
const messages = [];
const users = {}; // 사용자별로 소켓 정보를 저장할 객체
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', false);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/getChatData', async (req, res) => {
  const roomId = req.query.roomId;
  try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });
    const query = `
      SELECT *
      FROM chat_messages
      WHERE room_Id = ?;
    `;
    const [results] = await mysqlConnection.execute(query, [roomId]);
    await mysqlConnection.end(); // 연결 종료
    const groupedMessages = {};
    results.forEach((message) => {
      if (!groupedMessages[message.room_Id]) {
        groupedMessages[message.room_Id] = [];
      }
      groupedMessages[message.room_Id].push(message);
    });
    res.json(groupedMessages);
  } catch (error) {
    console.error('MySQL 연결 또는 쿼리 실행 오류:', error);
    return res.status(500).send('서버에서 오류가 발생했습니다.');
  }
});
app.get('/userMessages', async (req, res) => {
  const userId = req.session.user_id;
  try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });

    // 나한테 보낸 메시지와 내가 보낸 메시지를 모두 조회하는 쿼리
    const query = `
      SELECT *
      FROM chat_rooms
      WHERE seller = ? OR user_id = ?
    `;

    const [results] = await mysqlConnection.execute(query, [userId, userId]);

    await mysqlConnection.end(); // 연결 종료

    // 데이터 그룹화를 위한 빈 객체 생성
    const groupedMessages = {};

    // 데이터 그룹화
    results.forEach(message => {
      const key = message.goods_info + message.seller + message.user_id;
      if (!groupedMessages[key]) {
        groupedMessages[key] = message;
      }
    });

    const uniqueMessages = Object.values(groupedMessages);

    res.render('userMessages', { userId, uniqueMessages });
  } catch (error) {
    console.error('MySQL 연결 또는 쿼리 실행 오류:', error);
    return res.status(500).send('서버에서 오류가 발생했습니다.');
  }
});




// app.get('/userMessages', async (req, res) => {
//   const userId = req.session.user_id;
//   const sellerId = req.query.sellerId;
//   const goodsinfoname = req.query.goodsinfoname;

//   try {
//     const mysqlConnection = await mysql.createConnection({
//       host: 'localhost',
//       user: 'root',
//       password: 'root',
//       database: 'COIN',
//     });

//     // 나한테 보낸 메시지와 내가 보낸 메시지를 모두 조회하는 쿼리
//     const query = `
//       SELECT sender_id, receiver_id, message, timestamp
//       FROM chat_messages
//       WHERE receiver_id = ? OR sender_id = ?
//     `;

//     const [results] = await mysqlConnection.execute(query, [userId, userId]);
//     console.log("a123",sellerId,goodsinfoname);

//     await mysqlConnection.end(); // 연결 종료


//     // 사용자별로 메시지를 그룹화하여 합침
//     const groupedMessages = {};
//     results.forEach((message) => {
//       // 상대방의 ID 가져오기
//       const otherUserId = message.sender_id === userId ? message.receiver_id : message.sender_id;

//       if (groupedMessages[otherUserId]) {
//         groupedMessages[otherUserId].push(message);
//       } else {
//         groupedMessages[otherUserId] = [message];
//       }
//     });
//     res.render('userMessages', { userId, groupedMessages,sellerId, goodsinfoname });
//   } catch (error) {
//     console.error('MySQL 연결 또는 쿼리 실행 오류:', error);
//     return res.status(500).send('서버에서 오류가 발생했습니다.');
//   }
// });
// 이 코드는 서버 측 코드 (Node.js/Express)에 있어야 합니다.
io.on('connection', async (socket,req,res) => {
  console.log('새로운 사용자가 연결했습니다.');
 
  // 여기서 senderID 값을 어떻게 설정할지 확인하세요. 아래에서는 'us'로 설정되어 있습니다.
  const senderID = us;
  console.log("senderID", senderID);
  
  // 채팅 시작
  socket.on('startChat', async(data) => {
    const sellerId = `${data.sellerId}`;
    const tableID = `${data.goodsinfoname}`;
    const price = `${data.goodsinfoprice}`;
    socket.join(sellerId);
    console.log(`채팅 방에 입장: ${sellerId}`);
    io.to(socket.id).emit('roomName', sellerId);
    console.log("sned all",tableID,sellerId,price);

    try {
      // MySQL 연결 초기화
      const mysqlConnection = await createMysqlConnection();

      // 채팅 메시지를 MySQL에 저장
     // 채팅 메시지를 MySQL에 저장
// After inserting the message into the chat_rooms table, you can add a SELECT query to fetch the inserted data.
  const insertMessageQuery = `INSERT INTO chat_rooms (goods_info, seller, user_id ,goods_price) VALUES (?, ?, ?, ?)`;
  mysqlConnection.query(insertMessageQuery, [tableID, sellerId, senderID])
  .then(() => {
    console.log('메시지가 성공적으로 저장되었습니다.');
    
    // Now, let's retrieve the inserted data
   // After retrieving the inserted data
  
   

  })
  .catch((err) => {
    if (err.code === 'ER_DUP_ENTRY') {
      // Handle duplicate entry error
      console.error('중복된 데이터를 삽입하려고 시도했습니다.');
    } else {
      // Handle other query execution errors
      console.error('쿼리 실행 중 오류:', err);
    }
  });
  const selectMessageQuery = `SELECT *
  FROM chat_rooms
  WHERE goods_info = ?
  AND seller = ?
  AND user_id = ?`;

mysqlConnection.query(selectMessageQuery, [tableID, sellerId, senderID])
  .then((results) => {
    if (results.length > 0) {
      const id = results[0][0].id;
      const goods_info = results[0][0].goods_info;
      const seller = results[0][0].seller;
      const user_id = results[0][0].user_id;
      console.log("id", id);
      console.log("goodsInfo", goods_info);
      console.log("seller", seller);
      console.log("userId", user_id);
      const mes="messages";
  const insertMessageQuery2 = `INSERT INTO chat_messages (sender_id,receiver_id,message,goods_id,room_id) VALUES (?, ?, ? ,? ,?)`;
  mysqlConnection.query(insertMessageQuery2,[user_id, seller, mes,goods_info,id])
    .then(() => {
      console.log('메시지가 성공적으로 저장되었습니다.');
    })
    .catch((err) => {
      if (err.code === 'ER_DUP_ENTRY') {
        // 중복된 데이터 삽입 시 에러 처리
        console.error('중복된 데이터를 삽입하려고 시도했습니다.');
        // 추가적인 처리나 에러 응답을 수행하거나 서버 종료를 방지합니다.
      } else {
        // 다른 에러일 경우 에러 메시지 출력
        console.error('쿼리 실행 중 오류:', err);
      }
    });
    } else {
      console.log('Data not found.');
    }
  })
  .catch((error) => {
    console.error('Error: ', error);
  });
    } catch (error) {
      console.error('MySQL 연결 오류:', error);
    }
  });
  // 메시지 전송
  socket.on('message', async (data ) => {
  });
  socket.on('disconnect', () => {
    console.log('사용자가 연결을 끊었습니다.');
  });
});
app.get('/getChatRoomData', async (req, res) => {
  const chatRoomId = req.query.id; // 쿼리 매개변수에서 채팅방 ID 추출
  const loginuserID = req.query.loginuserID;
  console.log("chatss", chatRoomId, loginuserID);
  try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });

    // 나한테 보낸 메시지와 내가 보낸 메시지를 모두 조회하는 쿼리
    const query = `
      SELECT sender_id, receiver_id, message
      FROM chat_messages
      WHERE room_id = ? 
    `;

    const [results] = await mysqlConnection.execute(query, [chatRoomId]);

    if (results.length > 0) {
      console.log(results);
      return res.json(results);
    } else {
      console.log('Data not found.');
    }
  } catch (error) {
    console.error('MySQL 연결 오류:', error);
    return res.status(500).send('서버에서 오류가 발생했습니다.');
  }
});

const clients = new Set();
const wss2 = new WebSocket.Server({port:8083});
wss2.on('connection', (ws) => {
  clients.add(ws);

  ws.on('message', (message) => {
    // 새로운 메시지를 받았을 때 다른 모든 클라이언트에게 브로드캐스트
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
  });
});
const messages2 = [];


//스테이트
app.post('/snedState', async (req, res) => {
  console.log("데이터 전달");
  const joinuserID = req.body.userid;
  const rooid = req.body.roomid;
  const goodsid = req.body.goodsid2;
  console.log("pass id ", joinuserID,rooid,goodsid);

  try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });

    const query = `
      SELECT seller, user_id
      FROM chat_rooms
      WHERE id = ?
    `;
    const [results] = await mysqlConnection.execute(query, [rooid]);
   // console.log("result", results);

    if (results.length > 0) {
      console.log(results);
      const resultcid = results[0].seller;
      const resultsid = results[0].user_id;
      console.log("userid", resultcid, resultsid);

      if (joinuserID == resultcid) {
        try {
          const mysqlConnection = await createMysqlConnection();
          const updateCstateQuery = 'UPDATE chat_rooms SET sstate = 1 WHERE id = ?';
          mysqlConnection.query(updateCstateQuery, [rooid], (err, results) => {
            if (err) {
              console.error('sstate를 업데이트하는 중 오류 발생:', err);
              res.status(500).send('sstate를 업데이트하는 중 오류 발생');
            } else {
              console.log('sstate가 성공적으로 업데이트되었습니다.');
              res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
            }
          });
        } catch (error) {
          console.error('오류 발생:', error);
          res.status(500).send('서버에서 오류가 발생했습니다.');
        }
      } else {
        try {
          const mysqlConnection = await createMysqlConnection();
          const updateCstateQuery2 = 'UPDATE chat_rooms SET cstate = 1 WHERE id = ?';
          mysqlConnection.query(updateCstateQuery2, [rooid], (err, results) => {
            if (err) {
              console.error('cstate를 업데이트하는 중 오류 발생:', err);
              res.status(500).send('cstate를 업데이트하는 중 오류 발생');
            } else {
              console.log('cstate가 성공적으로 업데이트되었습니다.');
              res.json({ status: 'cstate가 성공적으로 업데이트되었습니다.' });
            }
          });
        } catch (error) {
          console.error('오류 발생:', error);
          res.status(500).send('서버에서 오류가 발생했습니다.');
        }
      }
    } else {
      console.log('데이터를 찾을 수 없습니다.');
      res.status(404).send('데이터를 찾을 수 없습니다.');
    }

    try {
      const mysqlConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '1234',
        database: 'mydatabase',
      });
  
      const query = `
        SELECT sstate, cstate
        FROM chat_rooms
        WHERE id = ?
      `;
      const [results] = await mysqlConnection.execute(query, [rooid]);
      console.log("result", results);
      console.log("goodsid values ",goodsid)
      if (results.length > 0) {
        //console.log(results);
        const sstate = results[0].sstate;
        const cstate = results[0].cstate;
       // console.log("userid", sstate, cstate);
        if(sstate =="1" && cstate =="1")
        {
          try {
            const mysqlConnection = await createMysqlConnection();
            const updateCstateQuery = 'UPDATE chat_rooms SET state = 1 WHERE id = ?';
            mysqlConnection.query(updateCstateQuery, [rooid], (err, results) => {
              if (err) {
                console.error('sstate를 업데이트하는 중 오류 발생:', err);
                res.status(500).send('sstate를 업데이트하는 중 오류 발생');
              } else {
                console.log('sstate가 성공적으로 업데이트되었습니다.');
                res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
              }
            });
          } catch (error) {
            console.error('오류 발생:', error);
            res.status(500).send('서버에서 오류가 발생했습니다.');
          }
          try {
            const mysqlConnection = await createMysqlConnection();
            const updateCstateQuery = 'UPDATE goods SET state = 1 WHERE goods_id = ?';
            mysqlConnection.query(updateCstateQuery, [goodsid], (err, results) => {
              if (err) {
                console.error('sstate를 업데이트하는 중 오류 발생:', err);
                res.status(500).send('sstate를 업데이트하는 중 오류 발생');
              } else {
                console.log('sstate가 성공적으로 업데이트되었습니다.');
                res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
              }
            });
          } catch (error) {
            console.error('오류 발생:', error);
            res.status(500).send('서버에서 오류가 발생했습니다.');
          }
        }
      
      }
      else {
        console.log('데이터를 찾을 수 없습니다.');
        res.status(404).send('데이터를 찾을 수 없습니다.');
      }
    } catch (error) {
        console.error('MySQL 연결 오류:', error);
        res.status(500).send('서버에서 오류가 발생했습니다.');
      }
  } catch (error) {
    console.error('MySQL 연결 오류:', error);
    res.status(500).send('서버에서 오류가 발생했습니다.');
  }





  console.log("sender pushMessages,");
  // 클라이언트에 응답
  res.json({ status: 'Message sent successfully' });
});

app.post('/paycoin', async (req, res) => {
  console.log("데이터 전달");
  const joinuserID = req.body.userid;
  const rooid = req.body.roomid;
  console.log("pass id ", joinuserID, rooid);

  const goodsid = req.body.goodsid;
  const bitname = await getBitcoinPrice();
  const userid = req.body.userid;
  const price = req.body.price; 
    console.log("coinssss",bitname,price);
    try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });

    const query = `
      SELECT walletaddress
      FROM users
      WHERE user_id = ?
    `;

    const [results] = await mysqlConnection.execute(query, [userid]);
    await mysqlConnection.end(); // 연결 종료
    const walletaddress = results[0].walletaddress;
    console.log("유저아이디",walletaddress);
  } catch (error) {
    console.error('MySQL 연결 또는 쿼리 실행 오류:', error);
    return res.status(500).send('서버에서 오류가 발생했습니다.');
  }
  try {
    const mysqlConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '1234',
      database: 'mydatabase',
    });
    const query = `
      SELECT seller, user_id
      FROM chat_rooms
      WHERE id = ?
    `;
    const [results] = await mysqlConnection.execute(query, [rooid]);
    console.log("result", results);
    if (results.length > 0) {
      console.log(results);
      const resultcid = results[0].seller;
      const resultsid = results[0].user_id;
      console.log("userid", resultcid, resultsid);
      if (joinuserID == resultcid) {
        try {
          const mysqlConnection = await createMysqlConnection();
          const updateCstateQuery = 'UPDATE chat_rooms SET sstate = 2 WHERE id = ?';
          mysqlConnection.query(updateCstateQuery, [rooid], (err, results) => {
            if (err) {
              console.error('sstate를 업데이트하는 중 오류 발생:', err);
              res.status(500).send('sstate를 업데이트하는 중 오류 발생');
            } else {
              console.log('sstate가 성공적으로 업데이트되었습니다.');
              res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
            }
          });
        } catch (error) {
          console.error('오류 발생:', error);
          res.status(500).send('서버에서 오류가 발생했습니다.');
        }
      } else {
        try {
          const mysqlConnection = await createMysqlConnection();
          const updateCstateQuery2 = 'UPDATE chat_rooms SET cstate = 2 WHERE id = ?';
          mysqlConnection.query(updateCstateQuery2, [rooid], (err, results) => {
            if (err) {
              console.error('cstate를 업데이트하는 중 오류 발생:', err);
              res.status(500).send('cstate를 업데이트하는 중 오류 발생');
            } else {
              console.log('cstate가 성공적으로 업데이트되었습니다.');
              res.json({ status: 'cstate가 성공적으로 업데이트되었습니다.' });
            }
          });
        } catch (error) {
          console.error('오류 발생:', error);
          res.status(500).send('서버에서 오류가 발생했습니다.');
        }
      }
    } else {
      console.log('데이터를 찾을 수 없습니다.');
      res.status(404).send('데이터를 찾을 수 없습니다.');
    }
    try {
      const mysqlConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '1234',
        database: 'mydatabase',
      });
      const query = `
        SELECT sstate, cstate
        FROM chat_rooms
        WHERE id = ?
      `;
      const [results] = await mysqlConnection.execute(query, [rooid]);
      console.log("result", results);
      if (results.length > 0) {
        console.log(results);
        const sstate = results[0].sstate;
        const cstate = results[0].cstate;
        console.log("userid", sstate, cstate);

        if(sstate =="2" && cstate =="2")
        {
          try {
            const mysqlConnection = await createMysqlConnection();
            const updateCstateQuery = 'UPDATE chat_rooms SET state = 2 WHERE id = ?';
            mysqlConnection.query(updateCstateQuery, [rooid], (err, results) => {
              if (err) {
                console.error('sstate를 업데이트하는 중 오류 발생:', err);
                res.status(500).send('sstate를 업데이트하는 중 오류 발생');
              } else {
                console.log('sstate가 성공적으로 업데이트되었습니다.');
                res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
                

              }
            });
          } catch (error) {
            console.error('오류 발생:', error);
            res.status(500).send('서버에서 오류가 발생했습니다.');
          }


          try {
            const mysqlConnection = await createMysqlConnection();
            const updateCstateQuery = 'UPDATE goods SET state = 2 WHERE goods_id = ?';
            mysqlConnection.query(updateCstateQuery, [goodsid], (err, results) => {
              if (err) {
                console.error('sstate를 업데이트하는 중 오류 발생:', err);
                res.status(500).send('sstate를 업데이트하는 중 오류 발생');
              } else {
                console.log('sstate가 성공적으로 업데이트되었습니다.');
                res.json({ status: 'sstate가 성공적으로 업데이트되었습니다.' });
                

              }
            });
          } catch (error) {
            console.error('오류 발생:', error);
            res.status(500).send('서버에서 오류가 발생했습니다.');
          }
        }
      }
      else {
        console.log('데이터를 찾을 수 없습니다.');
        res.status(404).send('데이터를 찾을 수 없습니다.');
      }
    } catch (error) {
        console.error('MySQL 연결 오류:', error);
        res.status(500).send('서버에서 오류가 발생했습니다.');
      }
  } catch (error) {
    console.error('MySQL 연결 오류:', error);
    res.status(500).send('서버에서 오류가 발생했습니다.');
  }
  
                 // const currency = "BTC"
                //  const currency = "BTC"
                //  const net_type = 'NETWORK'; // 출금 네트워크 종류
                //  const amount = req.body.amount; // 금액l
                //  const address = req.body.results;
                //  const transaction_type = 'internal'; // 바로출금 선택
                //  const body = {
                //      currency,
                //      net_type,
                //      amount,
                //      address,
                //      transaction_type,
                //  };
                //  const query = querystring.encode(body);
                //  const hash = crypto.createHash('sha512');
                //  const queryHash = hash.update(query, 'utf-8').digest('hex');
                //  const payload = {
                //      access_key,
                //      nonce: new Date().getTime().toString(),
                //      query_hash: queryHash,
                //      query_hash_alg: 'SHA512',
                //  };
                //  const token = sign(payload, secret_key);
                //  const options = {
                //      method: "POST",
                //      url: server_url + "/v1/withdraws/coin",
                //      headers: { Authorization: `Bearer ${token}` },
                //      data: body,
                //  };
              //    try {
              //     const response = await axios(options);
              //     res.render('result', { result: response.data });
              // } catch (error) {
              //     res.status(500).send('An error occurred');
              // }
//   try {
//     const response = await axios(options);
//     res.render('result', { result: response.data });
// } catch (error) {
//     res.status(500).send('An error occurred');
// }
  console.log("sender pushMessages,");
  // 클라이언트에 응답
  res.json({ status: 'Message sent successfully' });
});

// 클라이언트로부터 메시지를 받아 저장
app.post('/sendMessage', async(req, res) => {
  console.log("데이터 전달");
  const goodsInfo = req.body.goodsid;
  const sellerId = req.body.rid;
  const userId = req.body.cid;
  const messageInput = req.body.messageInput;
  const chatRoomId = req.body.roomid;
  const getuserid = req.session.user_id;
  console.log(getuserid);
  let recid;

if (getuserid === sellerId) {
  recid = userId;
} else {
  recid = sellerId;
}
  try {
    const mysqlConnection = await createMysqlConnection();
    const insertMessageQuery = 'INSERT INTO chat_messages (sender_id, receiver_id, message,goods_id,room_id) VALUES (?, ?, ? ,? ,?)';

      mysqlConnection.query(insertMessageQuery, [getuserid, recid, messageInput,goodsInfo,chatRoomId], (err, results) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            console.error('중복된 데이터를 삽입하려고 시도했습니다.');
          } else {
            console.error('쿼리 실행 중 오류:', err);
          }
          reject(err);
        } else {
          console.log('메시지가 성공적으로 저장되었습니다.');
          resolve(results);
        }
      });
  } catch (error) {
    console.error('오류 발생:', error);
  }
  
      

  messages2.push({ goodsInfo, sellerId, userId, messageInput,chatRoomId });
  console.log("sender pushMessages,", messages2);
  // 클라이언트에 응답
  res.json({ status: 'Message sent successfully' });
});




app.get('/market',async (req, res) => {app.set('view engine', 'ejs');
    isLogin = req.session['user_id'] ? true : false;
    try {
      const mysqlConnection = await createMysqlConnection();
    
      // MySQL에서 데이터를 가져오는 쿼리
      const query = `
        SELECT goods.goods_id, goods.title, images.url
        FROM goods
        LEFT JOIN images ON goods.goods_id = images.goods_id
      `;
      const [rows] = await mysqlConnection.query(query);
      const goodsList = rows;
      // goodsList를 웹 페이지로 전달하여 렌더링
      res.render('market', { isLogin ,goodsList });
    } catch (error) {
      console.error('데이터베이스에서 데이터를 가져오는 중 오류 발생:', error);
      res.status(500).send('데이터베이스 오류');
    }
  });

  //로그인 판별 코드 
app.get('/get-login-status', (req, res) => {
  const isLogin = req.session['user_id'] ? true : false;
  const userName = req.session['user_name'] || ''; // 사용자 이름 가져오기
  res.json({ isLogin, userName });
}); 

app.get('/mypage', async (req, res) => {
  const user_id = req.session.user_id; // 세션에서 user_id 가져오기

  if (!user_id) {
    return res.redirect('/user/login');
  }

  try {
    const payload = {
      access_key: access_key,
      nonce: uuidv4(),
    };
    const token = sign(payload, secret_key);

    const accountOptions = {
      method: 'GET',
      url: server_url + '/v1/accounts',
      headers: { Authorization: `Bearer ${token}` },
    };

    const accountResponse = await axios(accountOptions);
    const jsonData = accountResponse.data;
    const formattedValues = jsonData.map(obj => Object.values(obj));

    const marketOptions = {
      method: 'GET',
      url: `${server_url}/v1/market/all?isDetails=false`,
    };

    const marketResponse = await axios(marketOptions);
    const marketData = marketResponse.data;
    const marketDataK = marketData.filter(item => item.market.startsWith('K'));
    const marketEnglishName = marketDataK.map(item => item.english_name);

    res.render('mypage', { user_id, formattedValues, marketDataK, marketEnglishName });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error fetching data');
  }
});
//쿠키가 있는 상태면 main 페이지만 뜨게 구현 (애초에 이동도 불가)
app.get('/user/login', (req, res) => {
  // 이미 로그인한 사용자는 다른 페이지로 이동
  if (req.session['user_id']) {
    return res.redirect('/market');
  }
  res.render('login'); // login.ejs 템플릿 렌더링
});  

app.post('/user/login', async (req, res) => {
  const id_give = req.body.id_give;
  const password_give = req.body.password_give;
  try {
    const mysqlConnection = await createMysqlConnection();
    const [rows] = await mysqlConnection.query('SELECT * FROM users WHERE user_id = ? AND password = ?', [id_give, password_give]);
    const firstRow = rows[0];
    access_key = firstRow.accesskey;
    secret_key = firstRow.secretkey;
    const success = rows.length > 0;
    const message =success? "로그인에 성공했습니다." : "로그인에 실패했습니다.";
    if (success) {
      req.session.user_id = id_give; // 세션에 사용자 ID 저장
      us=id_give;
    }
    res.json({success,message});
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});
// 회원가입 뷰로 이동
app.get('/user/register', (req, res) => {
  res.render('sign_up');
});
// 회원가입 실행
app.post('/user/register', async (req, res) => {
  const { id_give, password_give, password_check, email_give ,access_key_give,secret_key_give,loc_give} = req.body;
 
  // 비밀번호와 비밀번호 확인이 일치하는지 확인
  if (password_give !== password_check) {
    return res.json({ success: false, message: "비밀번호와 비밀번호 확인이 일치하지 않습니다." });
  }

  try {
    const mysqlConnection = await createMysqlConnection();
    const [rows] = await mysqlConnection.query('INSERT INTO users (user_id, password, email, accesskey ,secretkey, loc) VALUES (?, ?, ?, ?, ?, ?)', [id_give, password_give, email_give,access_key_give,secret_key_give,loc_give]);

    if (rows.affectedRows === 1) {
      console.log('사용자 데이터 삽입 완료');
      res.json({ success: true }); // 회원가입 성공 후 리디렉션
    } else {
      console.error('사용자 데이터 삽입 오류');
      res.json({ success: false, message: "회원가입에 실패했습니다." });
    }
  } catch (error) {
    console.error('사용자 데이터 삽입 오류:', error);
    res.json({ success: false, message: "회원가입에 실패했습니다." });
  }
});

// 로그아웃 처리 라우트
app.post('/user/logout', (req, res) => {
  req.session.destroy((err) => {
      if (err) {
          console.error('Session destroy error:', err);
          res.status(500).json({ success: false, message: "로그아웃 실패" });
      } else {
          
          res.redirect('/market');
      }
  });
});

// 아 시발  존나하기싫다
// 회원 가입 성공 시 만 실행하는 환영합니다 코드 (크게 불필요 함)
app.get('/greeting', (req, res) => {
  res.render('greeting'); // greeting.ejs 파일 렌더링하여 클라이언트에게 전달
});
// 검색 기능 (MySQL 버전)
app.get('/goods/search', async (req, res) => {
  const user_id = req.session.user_id; // 세션에서 user_id 가져오기

  if (!user_id) {
    return res.redirect('/user/login');
  }
  const keywords = req.query.keywords;
  const senderId = req.session.user_id;
  try {
    const mysqlConnection = await createMysqlConnection();
    const [rows] = await mysqlConnection.query(
      'SELECT goods.*, images.url AS image_url FROM goods ' +
      'LEFT JOIN images ON goods.goods_id = images.goods_id ' +
      'WHERE goods.title LIKE ?',
      [`%${keywords}%`]
    );

    // 검색 결과를 렌더링할 수 있는 형식으로 가공
    const searched_goods = rows.map((row) => {
      const goods = { ...row };
      return goods;
    });

    res.render('goods', { searched_goods, keywords });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});



// POST /goods/image (MySQL 버전)
app.post('/goods/image', upload.single('file_give'), async (req, res) => {
  try {
    const imageName = req.file.filename;
    const currentDomain = `${req.protocol}://${req.get('host')}`;
    const imageURL = `${currentDomain}/uploads/${imageName}`;
    
    // 이미지 데이터를 MySQL images 테이블에 저장
    const mysqlConnection = await createMysqlConnection();
    const [imageResult] = await mysqlConnection.query(
      'INSERT INTO images (goods_id, url) VALUES (?, ?)',
      [null, imageURL] // goods_id는 초기에 null로 설정
    );

    imageId = imageResult.insertId;
    
    res.json({ success: true, imageId, imageURL }); // 이미지 ID와 URL 모두 전달
  } catch (error) {
    console.error('파일 업로드 에러:', error);
    res.json({ success: false, error: '이미지 업로드 에러' });
  }
});


//가져
async function getBitcoinPrice() {
  try {
   // console.log("시작부분");
    const response = await axios.get('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
   // console.log(response);
    return response.data[0].trade_price;
  } catch (error) {
    console.error('비트코인 가격을 가져오는 중 오류 발생:', error);
    return 'N/A';
  }
}



// GET /goods/create
app.get('/goods/create', (req, res) => {
  const user_id = req.session['user_id'];
  if (!user_id) {
    return res.redirect('/user/login');
  }
  res.render('goods_upload', {}); // goods.ejs 렌더링
});

app.post('/goods/create', upload.array('images_give'), async (req, res) => {
  const user_id = req.session['user_id'];
  const goods_name = req.body.title_give;
  const goods_price = req.body.price_give;
  const goods_desc = req.body.desc_give;

  try {
    const mysqlConnection = await createMysqlConnection();

    // 물품 데이터 삽입
    const [result] = await mysqlConnection.query(
      'INSERT INTO goods (user_id, title, price, description) VALUES (?, ?, ?, ?)',
      [user_id, goods_name, goods_price, goods_desc]
    );

    const goodsId = result.insertId;

    // 이미지와 물품 연결 데이터 업데이트
    await mysqlConnection.query(
        'UPDATE images SET goods_id = ? WHERE image_id = ?',
        [goodsId, imageId]
      );
    

    // 물품 좋아요 데이터 삽입
    await mysqlConnection.query(
      'INSERT INTO likes (goods_id, user_id) VALUES (?, ?)',
      [goodsId, user_id]
    );

    console.log('물품 데이터 삽입 및 이미지, 좋아요 데이터 삽입 완료');
    res.json({ success: true, msg: "물품이 등록되었습니다" });
  } catch (error) {
    console.error('물품 데이터 삽입 및 이미지, 좋아요 데이터 삽입 에러:', error);
    res.json({ success: false, message: "물품 등록에 실패했습니다." });
  }
});



// 페이지 자세히 보기 라우트 예시
// GET /goods/read/:id
app.get('/goods/read/:id', async (req, res) => {
  const user_id = req.session.user_id;
  const goodsId = req.params.id;
  const senderId = req.session.user_id;
  const bitcoinPrice = await getBitcoinPrice();
  try {
    // Retrieve the goods information from the database
    const mysqlConnection = await createMysqlConnection();
    
    const [goodsRow] = await mysqlConnection.query('SELECT * FROM goods WHERE goods_id = ?', [goodsId]);

    if (goodsRow.length > 0) {
      const goods = goodsRow[0];
      
      // Retrieve image URLs associated with the goods
      const [imageRows] = await mysqlConnection.query('SELECT url FROM images WHERE goods_id = ?', [goodsId]);
      const imageUrls = imageRows.map(row => `${row.url}`);
      
      // Retrieve the number of likes for the goods
      const [likesRow] = await mysqlConnection.query('SELECT COUNT(*) AS likesCount FROM likes WHERE goods_id = ?', [goodsId]);
      const likesCount = likesRow[0].likesCount;
      console.log("afuser",user_id);
      res.render('goods_info', { 
        user_id: user_id,
        goodsId: goodsId,
        title: goods.title,
        seller_id: goods.user_id, // Change to the appropriate field in your goods table
        desc: goods.description,
        price: goods.price,
        images: imageUrls,
        likesCount: likesCount,
        bit:bitcoinPrice
        // Add other necessary fields from the goods table
      });
    } else {
      // Handle the case when the goods cannot be found
      res.status(404).send('상품을 찾을 수 없습니다.');
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// 마이페이지 뷰 이동
app.get('/user/user_info', (req, res) => {
  const user_id = req.session.user_id; // 쿠키에서 user_id 가져오기
  if (!user_id) {
    return res.redirect('/user/login');
  }
  // user_id를 user_info.ejs 파일에 전달
  res.render('user_info', { user_id });
});
// 비밀번호 입력 페이지 렌더링
app.get('/user/:userId/enter-password', (req, res) => {
  const userId = req.params.userId;
  res.render('enterPassword', { user_id: userId });
});
// 비밀번호 확인 및 처리
app.post('/user/:userId/check-password', async (req, res) => {
  const userId = req.params.userId;
  const enteredPassword = req.body.password;
  try {
    const mysqlConnection = await createMysqlConnection();
    // MySQL 연결 후 사용자 정보 조회
    const [userRows] = await mysqlConnection.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    
    if (userRows.length === 0) {
      return res.status(404).send('User not found');
    }
    
    const user = userRows[0];
    
    // 비밀번호 비교 (실제로는 해싱된 비밀번호와의 비교를 해야합니다)
    if (enteredPassword === user.password) {
      // 비밀번호가 일치하면 사용자 정보 수정 또는 탈퇴 페이지로 이동
      res.render('edit_user');
    } else {
      // 비밀번호가 일치하지 않으면 다시 비밀번호 입력 페이지로 이동
      res.redirect(`/user/${userId}/enter-password`);
    }
  } catch (error) {               
    console.error('Error checking password:', error);
    res.status(500).send('Error checking password');
  }
});

// 회원 정보 수정 페이지 
app.get('/user/:userId/edit', (req, res) => {
  const userId = req.params.userId;
  res.render('enterPassword', { user_id: userId });
});
// POST /user/:userId/edit
app.post('/user/:userId/edit', async (req, res) => {
  const userId = req.params.userId;
  const {password_give, password_check, email_give } = req.body;

  // 비밀번호와 비밀번호 확인이 일치하는지 확인
  if (password_give !== password_check) {
    return res.json({ success: false, message: "비밀번호와 비밀번호 확인이 일치하지 않습니다." });
  }

  try {
    const mysqlConnection = await createMysqlConnection();
    await mysqlConnection.query('UPDATE users SET password = ?, email = ? WHERE user_id = ?', [password_give, email_give, userId]);

    // 성공적으로 업데이트되었을 경우
    res.json({ success: true, message: "회원 정보가 성공적으로 수정되었습니다." });
  } catch (error) {
    console.error('Error updating user info:', error);
    res.status(500).json({ success: false, message: "회원 정보 수정 오류" });
  }
});


// POST 마이 페이지 회원 탈퇴 기능
app.post('/user/:userId/delete', async (req, res) => {
  const userId = req.params.userId;

  try {
    const mysqlConnection = await createMysqlConnection();
    await mysqlConnection.execute('DELETE FROM users WHERE user_id = ?', [userId]);
    res.session.destroy('user_id');

    // 성공적으로 삭제되었을 경우
    res.json({ success: true, message: "사용자 정보가 성공적으로 삭제되었습니다." });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: "사용자 정보 삭제 오류" });
  }
});

// POST /goods/:goodsId/like --> 물품의 좋아요 개수를 확인하는 코드 , 좋아요 업데이트 기능
// POST /goods/:goodsId/like --> 물품의 좋아요 개수를 확인하는 코드 , 좋아요 업데이트 기능
app.post('/goods/:goodsId/like', async (req, res) => {
  const goodsId = req.params.goodsId;
  const userId = req.session['user_id'];
  const senderId = req.session.user_id;
  try {
    // ID로 물품 정보 가져오기
    const mysqlConnection = await createMysqlConnection();
    const [goodsResult] = await mysqlConnection.query('SELECT * FROM goods WHERE goods_id = ?', [goodsId]);
    const goods = goodsResult[0];

    if (!goods) {
      return res.status(404).json({ success: false, message: "물품을 찾을 수 없습니다." });
    }

    // 사용자가 이미 좋아요를 눌렀는지 확인
    const [likedResult] = await mysqlConnection.query('SELECT * FROM likes WHERE user_id = ? AND goods_id = ?', [userId, goodsId]);
    const alreadyLiked = likedResult.length > 0;

    if (!alreadyLiked) {
      // 좋아요가 없는 경우 사용자 ID와 물품 ID를 likes 테이블에 삽입
      await mysqlConnection.query('INSERT INTO likes (user_id, goods_id) VALUES (?, ?)', [userId, goodsId]);
    } else {
      // 이미 좋아요한 경우 해당 레코드를 삭제
      await mysqlConnection.query('DELETE FROM likes WHERE user_id = ? AND goods_id = ?', [userId, goodsId]);
    }

    // 좋아요 개수 업데이트
    const [updatedLikesResult] = await mysqlConnection.query('SELECT COUNT(*) AS likesCount FROM likes WHERE goods_id = ?', [goodsId]);
    const likesCount = updatedLikesResult[0].likesCount;

    res.json({ success: true, likesCount });
  } catch (error) {
    console.error('좋아요 업데이트 오류:', error);
    res.status(500).json({ success: false, message: "좋아요 업데이트 오류" });
  }
});

// GET /user/liked (좋아요를 한 목록을 보는 뷰)
app.get('/user/:userId/liked', async (req, res) => {
  const userId = req.params.userId;

  try {
    const mysqlConnection = await createMysqlConnection();
    // Retrieve the liked goods for the user
    const [likedGoodsResult] = await mysqlConnection.query('SELECT goods.* FROM goods JOIN likes ON goods.goods_id = likes.goods_id WHERE likes.user_id = ?', [userId]);
    const likedGoods = likedGoodsResult;

    // 뷰 템플릿에 likedGoods 데이터를 전달하여 렌더링
    res.render('like_list', { user_id: userId, likedGoods }); // user_id도 함께 전달
  } catch (error) {
    console.error('Error fetching liked goods:', error);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

app.get('/chat', (req, res) => {
  const user_id = req.session.user_id;
  const seller_id = req.query.seller; // 쿼리 매개변수에서 판매자 ID 가져오기
  if (!req.session['user_id']) {
    return res.redirect('/user/login');
  }
  res.render('chat', { name: user_id, seller: seller_id, color: '#ff0000' });
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('info', (data) => {
      console.log('User info received:', data);
      // Handle user info (nickname, color, etc.)
      // You can emit a 'notice' event to notify other users that someone has joined.
      io.emit('notice', `${data.nickname} has joined the chat.`);
        socket.nickname = data.nickname; // 소켓에 닉네임 저장
        socket.room = data.seller; // 소켓에 판매자 정보 저장 (방 정보로 활용)
        socket.join(data.seller); // 해당 판매자의 채팅 방에 입장
    });

    socket.on('send', (data) => {
      console.log('Message received:', data);
      // Handle the received message and its recipient (data.to)
      // You can then emit a 'newMessage' event to the sender and the recipient.
      io.to(socket.room).emit('newMessage', {
        nickname: socket.nickname,
        msg: data.msg,
        is_dm: true
    });
});
  socket.on('disconnect', () => {
      console.log('A user disconnected:', socket.id);
      // Handle user disconnection
  });
});
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // MySQL 서버 연결 검증 함수 실행
});