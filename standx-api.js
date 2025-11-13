const axios = require('axios');
const { ethers } = require('ethers');
const { ed25519 } = require('@noble/curves/ed25519');
const { base58 } = require('@scure/base');
const crypto = require('crypto');
const fs = require('fs');

// 기존 코드 상단에 추가
const TOKENS = {
  DUSD: {
    address: '0xaf44A1E76F56eE12ADBB7ba8acD3CbD474888122',
    decimals: 6,
    symbol: 'DUSD'
  },
  USDT: {
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    symbol: 'USDT'
  }
};

const SUSHI_ROUTER = '0xac4c6e212a361c968f1725b4d055b47e63f80b75'; // SushiSwap RedSnwapper
const SUSHI_POOLS = [
  '0xb67e5eaf770a384ab28029d08b9bc5ebe32beb0f',
  '0xf26de996845fb1e07f33af3c7f02b084965d6dde',
  '0x2ad9c1ad5b06f953b69d39d6685d725cd330b9c5',
  '0x15beac740434402f788345a4ae8f34dac2cd59ed'
].join(',');


class StandXAPI {
  constructor(config = {}) {
    this.baseURL = 'https://perps.standx.com';
    this.authURL = 'https://api.standx.com';
    this.chain = config.chain || 'bsc';
    this.walletAddress = null;
    this.privateKey = null;
    this.sessionId = null; // Session ID 추가

    // JWT 토큰
    this.jwtToken = null;

    // ed25519 키 페어
    this.ed25519PrivateKey = ed25519.utils.randomSecretKey();
    this.ed25519PublicKey = ed25519.getPublicKey(this.ed25519PrivateKey);
    this.requestId = base58.encode(this.ed25519PublicKey);

    // 봇 상태
    this.volumeBotRunning = false;
    this.botStats = {
      totalOrders: 0,
      totalVolume: 0,
      successfulOrders: 0,
      failedOrders: 0,
      startTime: null
    };

    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // JWT 파싱
  parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
  }

  // Body Signature 생성 (x-request-signature용)
  generateBodySignature(payload, xRequestId, xRequestTimestamp) {
    const version = 'v1';
    const message = `${version},${xRequestId},${xRequestTimestamp},${payload}`;
    const messageBytes = Buffer.from(message, 'utf-8');
    const signature = ed25519.sign(messageBytes, this.ed25519PrivateKey);
    return Buffer.from(signature).toString('base64');
  }

  // 간단한 Body Signature 생성 (x-body-signature용)
  generateSimpleBodySignature(payload) {
    const messageBytes = Buffer.from(payload, 'utf-8');
    const signature = ed25519.sign(messageBytes, this.ed25519PrivateKey);
    return Buffer.from(signature).toString('base64');
  }

  // 인증 - 전체 플로우
  async authenticate(walletAddress, privateKey) {
    try {
      this.privateKey = privateKey;

      // Private key로부터 지갑 생성하여 체크섬 주소 얻기
      let pk = privateKey;
      if (!pk.startsWith('0x')) {
        pk = '0x' + pk;
      }

      const wallet = new ethers.Wallet(pk);
      this.walletAddress = wallet.address; // 체크섬 주소!

      console.log('🔑 Step 1: Prepare sign-in...');
      console.log('   Wallet (checksum):', this.walletAddress);
      console.log('   RequestId:', this.requestId);

      const signedDataJwt = await this.prepareSignIn();

      console.log('🔑 Step 2: Parse JWT and get message...');
      const payload = this.parseJwt(signedDataJwt);

      console.log('🔑 Step 3: Sign message with wallet...');
      const signature = await this.signMessage(payload.message);

      console.log('🔑 Step 4: Login and get JWT token...');
      const loginResponse = await this.login(signature, signedDataJwt);

      this.jwtToken = loginResponse.token;
      console.log('✅ 인증 완료:', loginResponse);

      return loginResponse;
    } catch (error) {
      console.error('❌ 인증 실패:', error.response?.data || error.message);
      throw error;
    }
  }

  // Step 1: Prepare Sign-in
  async prepareSignIn() {
    const url = `${this.authURL}/v1/offchain/prepare-signin?chain=${this.chain}`;
    const data = {
      address: this.walletAddress,
      requestId: this.requestId
    };

    const response = await this.client.post(url, data);

    if (!response.data.success) {
      throw new Error('Failed to prepare sign-in');
    }

    return response.data.signedData;
  }

  // Step 2: Sign Message
  async signMessage(message) {
    try {
      if (!this.privateKey) {
        throw new Error('Private key not set');
      }

      let privateKey = this.privateKey;
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }

      const wallet = new ethers.Wallet(privateKey);
      const signature = await wallet.signMessage(message);

      console.log('   Signature:', signature);
      return signature;
    } catch (error) {
      console.error('   Sign error:', error);
      throw error;
    }
  }

  // Step 3: Login
  async login(signature, signedData) {
    const url = `${this.authURL}/v1/offchain/login?chain=${this.chain}`;
    const data = {
      signature,
      signedData
    };

    try {
      const response = await this.client.post(url, data);
      return response.data;
    } catch (error) {
      console.error('   Login error:', error.response?.data);
      throw error;
    }
  }

  // API 요청 헤더 생성
  getHeaders(needsSignature = false, payload = null) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.jwtToken) {
      headers['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    // Session ID 추가
    if (!this.sessionId) {
      this.sessionId = `session-${crypto.randomUUID()}`;
    }
    headers['x-session-id'] = this.sessionId;

    if (needsSignature && payload) {
      const xRequestId = crypto.randomUUID();
      const xRequestTimestamp = Date.now().toString();
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

      // x-request-signature 생성
      const requestSignature = this.generateBodySignature(payloadStr, xRequestId, xRequestTimestamp);

      // x-body-signature 생성
      const bodySignature = this.generateSimpleBodySignature(payloadStr);

      headers['x-request-sign-version'] = 'v1';
      headers['x-request-id'] = xRequestId;
      headers['x-request-timestamp'] = xRequestTimestamp;
      headers['x-request-signature'] = requestSignature;
      headers['x-body-signature'] = bodySignature;
    }

    return headers;
  }

  // 심볼 정보 조회
  async getSymbolInfo(symbol) {
    try {
      const response = await this.client.get(`${this.baseURL}/api/query_symbol_info`, {
        params: { symbol },
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 심볼 마켓 정보 조회
  async getMarket(symbol) {
    try {
      const response = await this.client.get(`${this.baseURL}/api/query_symbol_market`, {
        params: { symbol },
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 티커 조회
  async getTicker(symbol) {
    try {
      const response = await this.client.get(`${this.baseURL}/api/query_symbol_price`, {
        params: { symbol },
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 잔고 조회 (v2 사용!)
  async getBalance() {
    try {
      const response = await this.client.get(`${this.baseURL}/api/query_balance_v2`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 포지션 조회
  async getPositions(symbol = null) {
    try {
      const params = symbol ? { symbol } : {};
      const response = await this.client.get(`${this.baseURL}/api/query_positions`, {
        params,
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 오픈 오더 조회
  async getOpenOrders(symbol = null) {
    try {
      const params = symbol ? { symbol, limit: 500 } : { limit: 500 };
      const response = await this.client.get(`${this.baseURL}/api/query_open_orders`, {
        params,
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 주문 생성
  async placeOrder(orderData) {
    try {
      const { symbol, side, type, size, price, leverage, reduceOnly } = orderData;

      const data = {
        symbol,
        side,
        order_type: type,
        qty: size.toString(),
        time_in_force: type === 'market' ? 'ioc' : 'gtc',
        reduce_only: reduceOnly || false
      };

      // 시장가는 price를 "0"으로
      if (type === 'market') {
        data.price = "0";
      } else if (price) {
        data.price = price.toString();
      }

      const response = await this.client.post(
        `${this.baseURL}/api/new_order`,
        data,
        { headers: this.getHeaders(true, data) }
      );

      console.log(`✅ 주문 생성: ${side} ${size} ${symbol} @ ${price || 'market'}`);
      return response.data;
    } catch (error) {
      console.error(`❌ 주문 실패:`, error.response?.data || error.message);
      throw error;
    }
  }
  // BSC 토큰 잔고 조회
  async getTokenBalance(tokenAddress) {
    try {
      if (!this.privateKey) {
        throw new Error('Private key not set');
      }

      let pk = this.privateKey;
      if (!pk.startsWith('0x')) {
        pk = '0x' + pk;
      }

      const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
      const wallet = new ethers.Wallet(pk, provider);

      // ERC20 ABI (balanceOf만)
      const erc20Abi = [
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function approve(address spender, uint256 amount) returns (bool)'
      ];

      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
      const balance = await tokenContract.balanceOf(wallet.address);
      const decimals = await tokenContract.decimals();

      return {
        balance: balance.toString(),
        decimals: Number(decimals),
        formatted: ethers.formatUnits(balance, decimals)
      };
    } catch (error) {
      console.error('토큰 잔고 조회 실패:', error);
      throw error;
    }
  }

  // Sushi Quote 조회
  async getSushiQuote(fromToken, toToken, amount) {
    try {
      const fromTokenInfo = TOKENS[fromToken];
      const toTokenInfo = TOKENS[toToken];

      if (!fromTokenInfo || !toTokenInfo) {
        throw new Error('Invalid token');
      }

      // amount를 wei로 변환
      const amountWei = ethers.parseUnits(amount.toString(), fromTokenInfo.decimals);

      const url = `https://api.sushi.com/quote/v7/56?tokenIn=${fromTokenInfo.address}&tokenOut=${toTokenInfo.address}&amount=${amountWei.toString()}&maxSlippage=0.01&onlyPools=${SUSHI_POOLS}`;

      console.log('🔍 Sushi Quote 요청:', url);

      const response = await axios.get(url, {
        headers: {
          'accept': 'application/json'
        }
      });

      if (response.data.status === 'Success') {
        const quote = response.data;
        const assumedOut = ethers.formatUnits(quote.assumedAmountOut, toTokenInfo.decimals);

        console.log('✅ Quote 받음:', {
          amountIn: amount,
          amountOut: assumedOut,
          priceImpact: (quote.priceImpact * 100).toFixed(4) + '%',
          gasSpent: quote.gasSpent
        });

        return {
          ...quote,
          assumedAmountOutFormatted: assumedOut
        };
      } else {
        throw new Error('Quote failed: ' + response.data.status);
      }
    } catch (error) {
      console.error('❌ Sushi Quote 실패:', error.message);
      throw error;
    }
  }

  // 토큰 Approve
  async approveToken(tokenSymbol, amount) {
    try {
      if (!this.privateKey) {
        throw new Error('Private key not set');
      }

      const tokenInfo = TOKENS[tokenSymbol];
      if (!tokenInfo) {
        throw new Error('Invalid token');
      }

      let pk = this.privateKey;
      if (!pk.startsWith('0x')) {
        pk = '0x' + pk;
      }

      const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
      const wallet = new ethers.Wallet(pk, provider);

      const erc20Abi = [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)'
      ];

      const tokenContract = new ethers.Contract(tokenInfo.address, erc20Abi, wallet);

      // 현재 allowance 확인
      const currentAllowance = await tokenContract.allowance(wallet.address, SUSHI_ROUTER);
      const amountWei = ethers.parseUnits(amount.toString(), tokenInfo.decimals);

      console.log('현재 Allowance:', ethers.formatUnits(currentAllowance, tokenInfo.decimals));

      if (currentAllowance >= amountWei) {
        console.log('✅ 이미 충분한 Allowance가 있습니다');
        return { approved: true, existing: true };
      }

      console.log('🔐 Approve 트랜잭션 전송 중...');

      // Approve (무제한으로)
      const maxUint256 = ethers.MaxUint256;
      const tx = await tokenContract.approve(SUSHI_ROUTER, maxUint256);

      console.log('⏳ Approve 트랜잭션 대기 중:', tx.hash);
      const receipt = await tx.wait();

      console.log('✅ Approve 완료:', receipt.hash);

      return {
        approved: true,
        txHash: receipt.hash,
        existing: false
      };
    } catch (error) {
      console.error('❌ Approve 실패:', error);
      throw error;
    }
  }

  // 스왑 실행
  async executeSwap(fromToken, toToken, amount) {
    try {
      if (!this.privateKey) {
        throw new Error('Private key not set');
      }

      const fromTokenInfo = TOKENS[fromToken];
      const toTokenInfo = TOKENS[toToken];

      // 1. Quote 받기
      console.log(`🔄 ${fromToken} → ${toToken} 스왑 시작`);
      const quote = await this.getSushiQuote(fromToken, toToken, amount);

      // 2. Approve 확인
      console.log('🔐 Approve 확인 중...');
      await this.approveToken(fromToken, amount);

      // 3. Swap API 호출
      const amountWei = ethers.parseUnits(amount.toString(), fromTokenInfo.decimals);

      const swapUrl = `https://api.sushi.com/swap/v7/56`;
      const swapParams = {
        tokenIn: fromTokenInfo.address,
        tokenOut: toTokenInfo.address,
        amount: amountWei.toString(),
        maxSlippage: '0.01', // 0.5% → 1%로 증가
        sender: this.walletAddress,
        onlyPools: SUSHI_POOLS
      };

      console.log('🔍 Swap calldata 요청 중...');

      const swapResponse = await axios.get(swapUrl, {
        params: swapParams,
        headers: {
          'accept': 'application/json'
        }
      });

      if (swapResponse.data.status !== 'Success') {
        throw new Error('Swap API failed: ' + swapResponse.data.status);
      }

      console.log('📦 API 응답:', JSON.stringify(swapResponse.data, null, 2));

      const routeProcessorAddress = swapResponse.data.tx.to;
      const calldata = swapResponse.data.tx.data;

      console.log('📝 Router Address:', routeProcessorAddress);
      console.log('📝 Calldata length:', calldata?.length || 0);
      console.log('📝 Calldata:', calldata?.substring(0, 100) + '...');

      if (!calldata || calldata.length === 0) {
        throw new Error('Calldata가 비어있습니다!');
      }

      console.log('🚀 트랜잭션 전송 중...');

      // 4. 트랜잭션 전송
      let pk = this.privateKey;
      if (!pk.startsWith('0x')) {
        pk = '0x' + pk;
      }

      const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
      const wallet = new ethers.Wallet(pk, provider);

      // 트랜잭션 파라미터 구성
      const gasLimit = swapResponse.data.tx.gas
        ? ethers.toBigInt(swapResponse.data.tx.gas)
        : ethers.toBigInt(500000); // 300000 → 500000으로 증가

      const txParams = {
        to: routeProcessorAddress,
        data: calldata,
        gasLimit: gasLimit
      };

      // gasPrice가 있으면 추가
      if (swapResponse.data.tx.gasPrice) {
        txParams.gasPrice = ethers.toBigInt(swapResponse.data.tx.gasPrice);
      }

      console.log('📤 트랜잭션 파라미터:', {
        to: txParams.to,
        dataLength: txParams.data.length,
        gasLimit: txParams.gasLimit.toString(),
        gasPrice: txParams.gasPrice?.toString()
      });

      const tx = await wallet.sendTransaction(txParams);

      console.log('⏳ 트랜잭션 대기 중:', tx.hash);
      console.log('🔗 BSCScan:', `https://bscscan.com/tx/${tx.hash}`);

      const receipt = await tx.wait();

      if (receipt.status === 0) {
        throw new Error(`트랜잭션 실패! BSCScan에서 확인: https://bscscan.com/tx/${tx.hash}`);
      }

      console.log('✅ 스왑 완료!');

      return {
        success: true,
        txHash: receipt.hash,
        amountIn: amount,
        amountOut: quote.assumedAmountOutFormatted,
        priceImpact: quote.priceImpact,
        explorerUrl: `https://bscscan.com/tx/${receipt.hash}`
      };
    } catch (error) {
      // 트랜잭션 해시가 있으면 BSCScan 링크 출력
      if (error.receipt?.hash) {
        console.error('❌ 스왑 실패!');
        console.error('🔗 BSCScan에서 확인:', `https://bscscan.com/tx/${error.receipt.hash}`);
        console.error('💡 가능한 원인: 슬리피지 초과, 유동성 부족, 가스 부족');
      } else {
        console.error('❌ 스왑 실패:', error.message || error);
      }
      throw error;
    }
  }

  // 주문 취소
  async cancelOrder(orderId) {
    try {
      const data = { order_id: orderId };
      const response = await this.client.post(
        `${this.baseURL}/api/cancel_order`,
        data,
        { headers: this.getHeaders(true, data) }
      );
      console.log(`✅ 주문 취소: ${orderId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ 주문 취소 실패:`, error.message);
      throw error;
    }
  }

  // 여러 주문 취소
  async cancelOrders(orderIds) {
    try {
      const data = { orderIdList: orderIds };
      const response = await this.client.post(
        `${this.baseURL}/api/cancel_orders`,
        data,
        { headers: this.getHeaders(true, data) }
      );
      console.log(`✅ 주문 취소: ${orderIds.length}개`);
      return response.data;
    } catch (error) {
      console.error(`❌ 주문 취소 실패:`, error.message);
      throw error;
    }
  }

  // 레버리지 변경
  async changeLeverage(symbol, leverage) {
    try {
      const data = { symbol, leverage: parseInt(leverage) };
      const response = await this.client.post(
        `${this.baseURL}/api/change_leverage`,
        data,
        { headers: this.getHeaders(true, data) }
      );
      console.log(`✅ 레버리지 변경: ${symbol} ${leverage}x`);
      return response.data;
    } catch (error) {
      console.error(`❌ 레버리지 변경 실패:`, error.message);
      throw error;
    }
  }
  // 기존 코드에 추가

  // 포인트 조회
  async getPoints() {
    try {
      const response = await this.client.get(`${this.authURL}/v1/offchain/pre-deposit/points`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // 포지션 청산 (시장가로 반대 주문)
  async closePosition(symbol, size, side) {
    try {
      // 포지션의 반대 방향으로 주문
      const closeSide = side === 'buy' ? 'sell' : 'buy';

      const data = {
        symbol,
        side: closeSide,
        order_type: 'market',
        qty: Math.abs(size).toString(),
        price: "0",
        time_in_force: 'ioc',
        reduce_only: true // 포지션 청산 전용
      };

      const response = await this.client.post(
        `${this.baseURL}/api/new_order`,
        data,
        { headers: this.getHeaders(true, data) }
      );

      console.log(`✅ 포지션 청산: ${symbol} ${Math.abs(size)}`);
      return response.data;
    } catch (error) {
      console.error(`❌ 포지션 청산 실패:`, error.response?.data || error.message);
      throw error;
    }
  }
  // 거래량 봇 시작
  // 거래량 봇 시작 (수정)
  async startVolumeBot(config) {
    if (this.volumeBotRunning) {
      throw new Error('봇이 이미 실행 중입니다');
    }

    const {
      symbol,
      minSize,
      maxSize,
      intervalMin,
      intervalMax,
      priceVariance = 0.001
    } = config;

    // 최소 수량 검증
    const symbolInfo = await this.getSymbolInfo(symbol);
    const minOrderQty = parseFloat(symbolInfo[0]?.min_order_qty || 0.0001);

    if (minSize < minOrderQty) {
      throw new Error(`최소 주문 수량은 ${minOrderQty} 이상이어야 합니다`);
    }

    this.volumeBotRunning = true;
    this.botStats = {
      totalOrders: 0,
      totalVolume: 0,
      successfulOrders: 0,
      failedOrders: 0,
      startTime: Date.now()
    };

    console.log(`🤖 거래량 봇 시작: ${symbol}`);
    console.log(`   최소 수량: ${minSize}, 최대 수량: ${maxSize}`);

    const runBot = async () => {
      while (this.volumeBotRunning) {
        try {
          const ticker = await this.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last_price || ticker.mark_price);

          // 소수점 4자리로 수량 생성
          const size = (Math.random() * (maxSize - minSize) + minSize).toFixed(4);
          const side = Math.random() > 0.5 ? 'buy' : 'sell';
          const priceChange = currentPrice * priceVariance * (Math.random() * 2 - 1);
          const orderPrice = (currentPrice + priceChange).toFixed(2);

          console.log(`📝 주문 생성 시도: ${side} ${size} @ ${orderPrice}`);

          try {
            await this.placeOrder({
              symbol,
              side,
              type: 'limit',
              size,
              price: orderPrice
            });

            this.botStats.successfulOrders++;
            this.botStats.totalVolume += parseFloat(size);
          } catch (error) {
            console.error(`주문 실패: ${error.response?.data?.message || error.message}`);
            this.botStats.failedOrders++;
          }

          this.botStats.totalOrders++;

          // 잠시 대기 (Rate limit 방지)
          await new Promise(resolve => setTimeout(resolve, 500));

          // 반대 주문
          const oppositeSide = side === 'buy' ? 'sell' : 'buy';
          const oppositePrice = side === 'buy'
            ? (currentPrice - priceChange).toFixed(2)
            : (currentPrice + priceChange).toFixed(2);

          console.log(`📝 반대 주문 생성 시도: ${oppositeSide} ${size} @ ${oppositePrice}`);

          try {
            await this.placeOrder({
              symbol,
              side: oppositeSide,
              type: 'limit',
              size,
              price: oppositePrice
            });

            this.botStats.successfulOrders++;
            this.botStats.totalVolume += parseFloat(size);
          } catch (error) {
            console.error(`반대 주문 실패: ${error.response?.data?.message || error.message}`);
            this.botStats.failedOrders++;
          }

          this.botStats.totalOrders++;

          // 주기적으로 오래된 주문 취소
          if (this.botStats.totalOrders % 20 === 0) {
            try {
              const openOrders = await this.getOpenOrders(symbol);
              if (openOrders.result && openOrders.result.length > 0) {
                const now = Date.now();
                const oldOrders = openOrders.result.filter(order => {
                  const orderAge = now - new Date(order.created_at).getTime();
                  return orderAge > 120000; // 2분 이상
                });

                if (oldOrders.length > 0) {
                  console.log(`🗑️ 오래된 주문 ${oldOrders.length}개 취소`);
                  const orderIds = oldOrders.map(o => o.id);
                  await this.cancelOrders(orderIds);
                }
              }
            } catch (error) {
              console.error('오래된 주문 취소 실패:', error.message);
            }
          }

          // 대기
          const waitTime = Math.random() * (intervalMax - intervalMin) + intervalMin;
          console.log(`⏳ ${waitTime.toFixed(1)}초 대기...`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

        } catch (error) {
          console.error('❌ 봇 실행 오류:', error.message);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    };

    runBot();
    return { message: '거래량 봇 시작됨' };
  }

  // 거래량 봇 중지
  async stopVolumeBot() {
    this.volumeBotRunning = false;
    console.log('🛑 거래량 봇 중지');
    return { message: '거래량 봇 중지됨', stats: this.botStats };
  }

  // 봇 상태 조회
  getBotStatus() {
    return {
      running: this.volumeBotRunning,
      stats: this.botStats,
      runtime: this.botStats.startTime
        ? Math.floor((Date.now() - this.botStats.startTime) / 1000)
        : 0
    };
  }
}

module.exports = StandXAPI;
