package mage.webapi.cards.g;

import mage.constants.PhaseStep;
import mage.constants.Zone;
import mage.counters.CounterType;
import org.junit.Test;
import org.mage.test.serverside.base.CardTestPlayerBase;

/**
 * Regression test for a 2026-05-13 playtester report:
 *
 * <pre>
 * "Go-Shintai of Boundless Vigor is not allowing +1/+1 for each shrine
 *  you control. It does not allow player to add counters."
 * </pre>
 *
 * <p><b>Card text:</b> At the beginning of your end step, you may pay {1}.
 * When you do, put a +1/+1 counter on target Shrine for each Shrine you
 * control. (Source: {@code Mage.Sets/src/mage/cards/g/GoShintaiOfBoundlessVigor.java}.)
 *
 * <p><b>Engine path under test:</b>
 * <ol>
 *   <li>{@code BeginningOfEndStepTriggeredAbility} wraps
 *       {@code DoWhenCostPaid(ability, GenericManaCost(1), "Pay {1}?")}.</li>
 *   <li>If the controller chooses Yes and pays, the engine fires a
 *       {@code ReflexiveTriggeredAbility} whose effect is
 *       {@code AddCountersTargetEffect(P1P1, ShrinesYouControlCount.FOR_EACH)}.</li>
 *   <li>{@code ShrinesYouControlCount.FOR_EACH.calculate()} counts every
 *       Shrine the source controller controls at resolution time, including
 *       Go-Shintai itself.</li>
 * </ol>
 *
 * <p><b>This test extends {@code CardTestPlayerBase}</b>, which is part of the
 * upstream {@code Mage.Tests} harness. The WebApi pom is wired (CARDS-1) to
 * compile the harness via {@code build-helper-maven-plugin add-test-source}
 * and to run any {@code mage/webapi/cards/**} test with
 * {@code workingDirectory=../Mage.Tests} so the harness can resolve
 * {@code config/config.xml} and the {@code RB Aggro.dck} default deck.
 *
 * <p>This test file lives under {@code Mage.Server.WebApi/} (our module),
 * not under {@code Mage.Tests/}, to honor CLAUDE.md rule 2 (no modifications
 * to upstream-tracked directories without sign-off).
 *
 * @author Claude (CARDS-1, 2026-05-13)
 */
public class GoShintaiOfBoundlessVigorTest extends CardTestPlayerBase {

    private static final String goShintai = "Go-Shintai of Boundless Vigor";
    // Other Shrines, vanilla enough to keep their effects out of the way:
    private static final String honden = "Honden of Cleansing Fire"; // {3}{W} Shrine
    private static final String sanctum = "Sanctum of Tranquil Light"; // {W} Shrine

    /**
     * Primary regression — three Shrines on the battlefield, player pays {1}
     * during end step, targets Go-Shintai. Expected: 3 +1/+1 counters land
     * on Go-Shintai (one per Shrine: Go-Shintai + Honden + Sanctum).
     */
    @Test
    public void threeShrines_payOne_targetSelf_putsThreeCounters() {
        setStrictChooseMode(true);

        addCard(Zone.BATTLEFIELD, playerA, goShintai);
        addCard(Zone.BATTLEFIELD, playerA, honden);
        addCard(Zone.BATTLEFIELD, playerA, sanctum);
        // One Plains lets the engine auto-pay the {1} generic cost during
        // the end-step trigger resolution.
        addCard(Zone.BATTLEFIELD, playerA, "Plains", 1);

        // The end step trigger goes on the stack; "Pay {1}?" is the choice
        // prompt the engine pops up.
        setChoice(playerA, true); // Yes, pay {1}
        addTarget(playerA, goShintai);

        setStopAt(1, PhaseStep.CLEANUP);
        execute();

        assertCounterCount(playerA, goShintai, CounterType.P1P1, 3);
    }

    /**
     * Edge — only Go-Shintai on the battlefield; "Shrines you control"
     * counts the source. Expected: 1 +1/+1 counter (the regression report
     * claims this is broken: "does not allow player to add counters").
     */
    @Test
    public void onlyGoShintai_payOne_targetSelf_putsOneCounter() {
        setStrictChooseMode(true);

        addCard(Zone.BATTLEFIELD, playerA, goShintai);
        addCard(Zone.BATTLEFIELD, playerA, "Plains", 1);

        setChoice(playerA, true); // Yes, pay {1}
        addTarget(playerA, goShintai);

        setStopAt(1, PhaseStep.CLEANUP);
        execute();

        assertCounterCount(playerA, goShintai, CounterType.P1P1, 1);
    }

    /**
     * Edge — declining the optional payment leaves the target Shrine with
     * zero +1/+1 counters. Confirms the reflexive trigger does not fire on
     * "No, don't pay".
     */
    @Test
    public void threeShrines_dontPay_noCounters() {
        setStrictChooseMode(true);

        addCard(Zone.BATTLEFIELD, playerA, goShintai);
        addCard(Zone.BATTLEFIELD, playerA, honden);
        addCard(Zone.BATTLEFIELD, playerA, sanctum);
        addCard(Zone.BATTLEFIELD, playerA, "Plains", 1);

        setChoice(playerA, false); // No, do not pay

        setStopAt(1, PhaseStep.CLEANUP);
        execute();

        assertCounterCount(playerA, goShintai, CounterType.P1P1, 0);
    }

    /**
     * Edge — target a Shrine OTHER than Go-Shintai. Expected: the named
     * target gets 3 counters (one per Shrine controller controls, including
     * Go-Shintai itself), Go-Shintai stays at 0.
     */
    @Test
    public void threeShrines_payOne_targetOtherShrine_putsThreeCountersThere() {
        setStrictChooseMode(true);

        addCard(Zone.BATTLEFIELD, playerA, goShintai);
        addCard(Zone.BATTLEFIELD, playerA, honden);
        addCard(Zone.BATTLEFIELD, playerA, sanctum);
        addCard(Zone.BATTLEFIELD, playerA, "Plains", 1);

        setChoice(playerA, true); // Yes, pay {1}
        addTarget(playerA, honden);

        setStopAt(1, PhaseStep.CLEANUP);
        execute();

        assertCounterCount(playerA, honden, CounterType.P1P1, 3);
        assertCounterCount(playerA, goShintai, CounterType.P1P1, 0);
        assertCounterCount(playerA, sanctum, CounterType.P1P1, 0);
    }
}
