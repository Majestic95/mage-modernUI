package mage.webapi.mapper;

import mage.view.CardView;
import mage.view.CombatGroupView;
import mage.view.PermanentView;
import mage.webapi.dto.stream.WebCombatGroupView;
import mage.webapi.dto.stream.WebPermanentView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Upstream {@link CombatGroupView} → wire {@link WebCombatGroupView}.
 *
 * <p>Upstream stores attackers / blockers as {@code CardsView}
 * ({@code Map<UUID, CardView>}) but populates each entry with a
 * {@link PermanentView} via the {@code put(id, new PermanentView(...))}
 * call site (see {@code CombatGroupView.java:41}). The cast back to
 * {@code PermanentView} is safe; defensive logging surfaces upstream
 * drift if that invariant ever breaks.
 */
public final class CombatGroupMapper {

    private static final Logger LOG = LoggerFactory.getLogger(CombatGroupMapper.class);

    private CombatGroupMapper() {
    }

    public static WebCombatGroupView toDto(CombatGroupView cg) {
        if (cg == null) {
            throw new IllegalArgumentException("CombatGroupView must not be null");
        }
        return new WebCombatGroupView(
                cg.getDefenderId() == null ? "" : cg.getDefenderId().toString(),
                cg.getDefenderName() == null ? "" : cg.getDefenderName(),
                permanentsFromCardsView(cg.getAttackers()),
                permanentsFromCardsView(cg.getBlockers()),
                cg.isBlocked()
        );
    }

    /**
     * Translate a {@code CardsView} whose entries are actually
     * {@link PermanentView} (the upstream invariant for combat) into a
     * wire-format permanent map. Non-PermanentView entries are logged
     * and skipped — never silently downcast to a bare card view, since
     * combat without battlefield state would mislead the renderer.
     */
    private static Map<String, WebPermanentView> permanentsFromCardsView(
            Map<UUID, CardView> source) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }
        Map<String, WebPermanentView> out = new LinkedHashMap<>(source.size());
        for (Map.Entry<UUID, CardView> e : source.entrySet()) {
            UUID id = e.getKey();
            CardView v = e.getValue();
            if (id == null || v == null) continue;
            if (!(v instanceof PermanentView pv)) {
                LOG.warn("CombatGroup entry not a PermanentView: id={}, type={}",
                        id, v.getClass().getName());
                continue;
            }
            out.put(id.toString(), CardViewMapper.toPermanentDto(pv));
        }
        return out;
    }
}
