import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, auth, createAuction, createProduct, createUser, describeDb, prisma, resetDb } from "../helpers/integration.js";

function signedToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET ?? "livebidx-dev-secret").update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describeDb("auth API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("registers as CUSTOMER by default and token works with /me", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ nickname: "买家", email: "buyer@test.local", password: "password123" })
      .expect(201);

    expect(register.body.user.role).toBe("CUSTOMER");

    const me = await request(app).get("/api/auth/me").set(auth(register.body.token)).expect(200);
    expect(me.body.user.email).toBe("buyer@test.local");
  });

  it("allows explicit HOST registration", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ nickname: "商家", email: "host@test.local", password: "password123", role: "HOST" })
      .expect(201);

    expect(response.body.user.role).toBe("HOST");
  });

  it("rejects invalid role, missing nickname, short password and duplicate email", async () => {
    await request(app).post("/api/auth/register").send({ nickname: "x", email: "bad-role@test.local", password: "password123", role: "ADMIN" }).expect(400);
    await request(app).post("/api/auth/register").send({ email: "missing@test.local", password: "password123" }).expect(400);
    await request(app).post("/api/auth/register").send({ nickname: "x", email: "short@test.local", password: "123" }).expect(400);

    await request(app).post("/api/auth/register").send({ nickname: "x", email: "dup@test.local", password: "password123" }).expect(201);
    await request(app).post("/api/auth/register").send({ nickname: "x", email: "dup@test.local", password: "password123" }).expect(409);
  });

  it("logs in and rejects bad login attempts", async () => {
    await request(app).post("/api/auth/register").send({ nickname: "买家", email: "login@test.local", password: "password123" }).expect(201);

    const ok = await request(app).post("/api/auth/login").send({ email: "login@test.local", password: "password123" }).expect(200);
    expect(ok.body.token).toBeTruthy();
    await request(app).post("/api/auth/login").send({ email: "missing@test.local", password: "password123" }).expect(404);
    await request(app).post("/api/auth/login").send({ email: "login@test.local", password: "wrong" }).expect(401);
    await request(app).post("/api/auth/login").send({ email: "login@test.local" }).expect(400);
  });

  it("rejects missing, tampered and wrong-role tokens on protected routes", async () => {
    const host = await createUser("HOST");
    const customer = await createUser("CUSTOMER");
    const tampered = `${host.token.slice(0, -1)}x`;
    const expired = signedToken({ userId: customer.user.id, role: "CUSTOMER", exp: Date.now() - 1 });

    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").set(auth(tampered)).expect(401);
    await request(app).get("/api/auth/me").set(auth(expired)).expect(401);
    await request(app).post("/api/products").set(auth(customer.token)).send({}).expect(403);
    await request(app).post("/api/auctions").set(auth(customer.token)).send({}).expect(403);
    await request(app).get("/api/mobile/live-rooms").set(auth(host.token)).expect(403);
  });
});

describeDb("product API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("lets HOST create draft and reviewing products", async () => {
    const { token } = await createUser("HOST");

    const draft = await request(app).post("/api/products").set(auth(token)).send({
      title: "草稿拍品",
      category: "水果",
      imageUrl: "https://example.com/a.jpg",
      startPrice: 100,
      minIncrement: 20,
      capPrice: 120
    }).expect(201);
    expect(draft.body.product.status).toBe("DRAFT");

    const reviewing = await request(app).post("/api/products").set(auth(token)).send({
      title: "审核拍品",
      category: "水果",
      imageUrl: "https://example.com/b.jpg",
      startPrice: 100,
      minIncrement: 20,
      capPrice: 120,
      mode: "submit"
    }).expect(201);
    expect(reviewing.body.product.status).toBe("REVIEWING");
  });

  it("rejects invalid product payloads and CUSTOMER access", async () => {
    const host = await createUser("HOST");
    const customer = await createUser("CUSTOMER");
    const valid = { title: "拍品", category: "水果", imageUrl: "https://example.com/a.jpg", startPrice: 100, minIncrement: 20, capPrice: 120 };

    await request(app).post("/api/products").set(auth(customer.token)).send(valid).expect(403);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, title: "" }).expect(400);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, startPrice: 0 }).expect(400);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, minIncrement: 0 }).expect(400);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, capPrice: 100 }).expect(400);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, capPrice: 119 }).expect(400);
    await request(app).post("/api/products").set(auth(host.token)).send({ ...valid, capPrice: 120 }).expect(201);
  });

  it("updates products and validates PATCH cap price rules", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id, { title: "旧标题", startPrice: 100, minIncrement: 20, capPrice: 150 });

    const updated = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(token))
      .send({ title: "新标题", startPrice: 120, minIncrement: 30, capPrice: 180 })
      .expect(200);
    expect(updated.body.product.title).toBe("新标题");
    expect(updated.body.product.startPrice).toBe(120);
    expect(updated.body.product.minIncrement).toBe(30);
    expect(updated.body.product.capPrice).toBe(180);

    await request(app).patch(`/api/products/${product.id}`).set(auth(token)).send({ capPrice: 120 }).expect(400);
    await request(app).patch(`/api/products/${product.id}`).set(auth(token)).send({ capPrice: 149 }).expect(400);
    await request(app).patch(`/api/products/${product.id}`).set(auth(token)).send({ capPrice: 150 }).expect(200);
  });

  it("rejects product PATCH while a related auction is running", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    await createAuction(user.id, product.id);

    await request(app).patch(`/api/products/${product.id}`).set(auth(token)).send({ title: "不能改" }).expect(409);
  });

  it("hard deletes products without auction history and archives products with history", async () => {
    const { user, token } = await createUser("HOST");
    const plainProduct = await createProduct(user.id);
    await request(app).delete(`/api/products/${plainProduct.id}`).set(auth(token)).expect(200).expect((res) => {
      expect(res.body.mode).toBe("DELETED");
    });

    const historicalProduct = await createProduct(user.id);
    await createAuction(user.id, historicalProduct.id, null, { status: "ENDED" });
    const archived = await request(app).delete(`/api/products/${historicalProduct.id}`).set(auth(token)).expect(200);
    expect(archived.body.mode).toBe("ARCHIVED");
    expect(archived.body.product.status).toBe("ARCHIVED");
  });

  it("rejects deleting products with running auction", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    await createAuction(user.id, product.id);

    await request(app).delete(`/api/products/${product.id}`).set(auth(token)).expect(409);
  });
});
