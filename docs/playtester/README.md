# Playtester How-To Guides

Per-card "how do I actually use this?" guides for cards/mechanics that have generated playtester confusion. Each guide is verified against the engine via a passing Mage.Tests-style regression test, so the steps reflect what the code actually does — not what we *think* it does.

When a future engine question comes up:

1. Write a `Mage.Server.WebApi/src/test/java/mage/webapi/cards/...Test.java` repro that exercises the mechanic.
2. Run it (`mvn -f Mage.Server.WebApi/pom.xml org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test@cards-tests -Dtest=YourTestName`).
3. If it passes, the engine is correct — drop a new file here with the step-by-step.
4. If it fails, file an upstream issue and add a "known-broken" callout to the guide.

Audience: a playtester who knows MTG basics but isn't expected to read engine source.

## Current guides

| Card / Mechanic | Source of confusion | Engine status |
|---|---|---|
| [Go-Shintai of Boundless Vigor](go-shintai-of-boundless-vigor.md) | "+1/+1 counters aren't appearing" | ✅ Working — two-stage prompt; players were missing stage 2 |
| [Airbend (keyword)](airbend.md) | "Can't pay 2 to bring the creature back" | ✅ Working — wrong player was checking the exile zone |
