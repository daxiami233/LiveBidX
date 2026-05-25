import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, auth, createAuction, createProduct, createUser, describeDb, prisma, resetDb } from "../helpers/integration.js";

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
