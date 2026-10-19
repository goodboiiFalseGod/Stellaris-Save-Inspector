'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {root: gameRoot} = require('./test-game-root.cjs');
const tech = require('./technology.js');

const source = `
tech_seed = { area = physics tier = 0 weight = 10 start_tech = yes }
tech_path = { area = physics tier = 1 prerequisites = { tech_seed } weight = 20 weight_modifier = { factor = 2 modifier = { factor = 0 has_country_flag = no_path } } }
tech_target = { area = physics tier = 2 prerequisites = { tech_path } potential = { has_civic = civic_test } weight = 5 }
tech_noise = { area = physics tier = 0 weight = 15 }
tech_unlock_noise = { area = physics tier = 1 prerequisites = { tech_seed } weight = 12 }
tech_society_target = { area = society tier = 0 weight = 1 }
`;
const parsed = tech.parseDefinitions([source], `0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 }`);
tech._setDefinitions(parsed);
tech._setVariables(new Map([['@base', 10], ['@factor', 2], ['@add', 3]]));
assert.equal(parsed.byId.get('tech_path').prerequisites[0], 'tech_seed', 'парсер читает prerequisites');
assert.equal(parsed.byId.get('tech_target').tier, 2, 'парсер читает tier');
const visualDefinitions = tech.parseDefinitions(['tech_common = { area = physics category = { computing } } tech_rare = { area = society category = { biology } is_rare = yes } tech_dangerous = { area = engineering category = { voidcraft } is_rare = yes is_dangerous = yes }'], '0 = { }');
assert.equal(visualDefinitions.byId.get('tech_common').rarity, 'common', 'обычная технология получает обычную палитру');
assert.equal(visualDefinitions.byId.get('tech_rare').rarity, 'rare', 'парсер читает игровую редкость');
assert.equal(visualDefinitions.byId.get('tech_dangerous').rarity, 'dangerous', 'опасность приоритетнее редкости');
assert.deepEqual(visualDefinitions.byId.get('tech_dangerous').categories, ['voidcraft'], 'парсер сохраняет игровую категорию для иконки');
const special = tech.parseDefinitions(['tech_event = { area = physics tier = 0 weight = 0 } tech_conditional = { area = physics tier = 0 weight = 0 weight_modifier = { modifier = { add = 10 always = yes } } } tech_override = { area = physics tier = 0 weight = 0 weight = 20 }'], '0 = { }');
assert.equal(special.byId.get('tech_event').eventOnly, true, 'literal zero without additive path is event-only');
assert.equal(special.byId.get('tech_conditional').eventOnly, false, 'conditional additive path stays drawable');
assert.equal(special.byId.get('tech_override').eventOnly, false, 'last weight assignment wins');
const swapSpecial = tech.parseDefinitions(['tech_swap = { area = physics tier = 0 weight = 0 technology_swap = { weight = { factor = 1 } } }'], '0 = { }');
assert.equal(swapSpecial.byId.get('tech_swap').eventOnly, true, 'swap factor cannot revive zero normal draw weight');
const additiveSpecial = tech.parseDefinitions(['tech_add_half = { area = physics tier = 0 weight = 0 weight_modifier = { modifier = { add = 0.5 } } } tech_add_dynamic = { area = physics tier = 0 weight = 0 weight_modifier = { modifier = { add = value:dynamic_weight } } } tech_add_zero = { area = physics tier = 0 weight = 0 weight_modifier = { modifier = { add = 0 } } }'], '0 = { }');
assert.equal(additiveSpecial.byId.get('tech_add_half').eventOnly, false);
assert.equal(additiveSpecial.byId.get('tech_add_dynamic').eventOnly, false);
assert.equal(additiveSpecial.byId.get('tech_add_zero').eventOnly, true);

const state = {researched: new Set(['tech_seed']), flags: new Set(), modifiers: new Set(), traits: new Set(), ethics: new Set(), civics: new Set(['civic_test']), authority: '', origin: ''};
assert.equal(tech.evaluate(parsed.byId.get('tech_path'), state).status, 'available', 'выполненный prerequisite открывает технологию');
const researchedResult = tech.evaluate(parsed.byId.get('tech_seed'), {...state, researched: new Set(['tech_seed'])});
assert.deepEqual(researchedResult.missing, [], 'researched result keeps render-safe missing array');
assert.deepEqual(researchedResult.unknown, [], 'researched result keeps render-safe unknown array');
assert.equal(tech.evaluate(parsed.byId.get('tech_target'), state).status, 'locked', 'tier gate и prerequisite блокируют следующий tier');
assert.equal(tech.weight(parsed.byId.get('tech_path'), state).value, 40, 'условный weight factor применяется');
const variableTech = {weight: '@base', weightModifier: 'factor = @factor modifier = { add = @add always = yes }'};
assert.equal(tech.weight(variableTech, state).value, 23, 'base/factor/add resolve scripted variables');
assert.ok(tech.weight({weight: '@missing', weightModifier: ''}, state).unknown.includes('@missing'), 'unresolved variable is partial');
assert.equal(tech.weight({weight: '@missing', weightModifier: ''}, state).value, 1, 'unresolved base remains drawable estimate');
assert.equal(tech.chanceText(.0099, .0909), 'target chance 0.99% → 9.09%', 'chance formatter is safe and testable');
const disabled = {...state, flags: new Set(['no_path'])};
assert.equal(tech.weight(parsed.byId.get('tech_path'), disabled).value, 0, 'factor 0 убирает карточку из пула');
const unknown = tech.condition('any_owned_planet = { is_planet_class = pc_gaia }', state);
assert.equal(unknown.value, null);
assert.deepEqual(unknown.unknown, ['any_owned_planet'], 'неподдержанный trigger помечается unknown, а не объявляется ложным');
assert.equal(tech.condition('OR = { always = yes any_owned_planet = { } }', state).value, true, 'true OR unknown = true');
assert.equal(tech.condition('NOT = { any_owned_planet = { } }', state).value, null, 'NOT unknown = unknown');
assert.equal(tech.condition('NOR = { always = no any_owned_planet = { } }', state).value, null, 'NOR false/unknown = unknown');

const steps = tech.recommendation(state, 'tech_target');
assert.equal(steps[0].tech.id, 'tech_path', 'путь к target приоритетнее очистки пула');
const renderPlan = tech.targetPlan(state, 'tech_target', 'physics');
assert.equal(renderPlan.target.id, 'tech_target', 'render path keeps target object only for display');
assert.ok(Array.isArray(renderPlan.items), 'render path passes target ID to recommendation');
assert.ok(steps.some(item => item.tech.id === 'tech_noise'), 'пул содержит побочные технологии для оценки dilution');
assert.equal(tech.findTarget('society target').id, 'tech_society_target', 'ручной выбор target работает по локализованному/читаемому имени');

const save = `country = { 7 = { tech_status = { technology = tech_seed level = 1 technology = tech_path level = 1 } alternatives = { physics = { technology = tech_noise } } flags = { no_path = 1 } ethos = { ethic = ethic_xenophile } government = { authority = auth_democratic civic = civic_test origin = origin_default } } }`;
const saved = tech.stateFromSave(save, {id: '7'});
assert.ok(saved.researched.has('tech_path'), 'из save читается tech_status');
assert.ok(saved.alternatives.has('tech_noise'), 'из save читаются saved alternatives');
assert.ok(saved.flags.has('no_path'), 'из save читаются country flags');
assert.ok(saved.civics.has('civic_test'));
assert.equal(saved.authority, 'auth_democratic');
const savedNomad = tech.stateFromSave(`country = { 7 = { is_nomadic = yes tech_status = { } } }`, {id: '7'});
assert.equal(savedNomad.isNomadic, true, 'is_nomadic is read directly from the real country save block');
const savedUnknownNomad = tech.stateFromSave(`country = { 7 = { tech_status = { } } }`, {id: '7'});
assert.equal(savedUnknownNomad.isNomadic, undefined, 'missing is_nomadic remains unknown instead of being coerced to non-nomadic');
const negative = tech.stateFromSave(`country = { 7 = { tech_status = { technology = tech_cosmogenesis_thesis level = -1 } } }`, {id: '7'});
assert.equal(negative.levels.get('tech_cosmogenesis_thesis'), -1, 'negative technology level is retained');
const bare = tech.stateFromSave(`country = { 7 = { tech_status = { alternatives = { physics = { tech_seed tech_path tech_noise tech_target } society = { tech_society_target } engineering = { tech_seed } } } } }`, {id: '7'});
assert.equal(bare.alternatives.size, 5, 'bare per-area alternatives are parsed');
state.alternatives = new Set(['tech_target', 'tech_noise']);
assert.equal(tech.recommendation(state, 'tech_target')[0].tech.id, 'tech_target', 'offered target ranks first');
assert.equal(tech.planSearch(state, 'tech_target', 4).status, 'reached', 'bounded planner can follow available path');
const repeat = tech.parseDefinitions(['tech_loop = { area = physics tier = 0 levels = -1 weight = 1 } tech_cap = { area = physics tier = 0 levels = 2 weight = 1 } tech_phy = { area = physics tier = 0 weight = 1 } tech_eng_target = { area = engineering tier = 0 prerequisites = { tech_phy } weight = 1 }'], '0 = { }'); tech._setDefinitions(repeat);
const repeatState = {...state, researched: new Set(['tech_loop', 'tech_cap']), levels: new Map([['tech_loop', 4], ['tech_cap', 2]]), alternatives: new Set(['tech_loop'])};
assert.match(tech.evaluate(repeat.byId.get('tech_loop'), repeatState).status, /^available/, 'infinite repeatable remains available');
assert.equal(tech.evaluate(repeat.byId.get('tech_cap'), repeatState).status, 'researched', 'finite repeatable stops at cap');
assert.equal(tech.planSearch(repeatState, 'tech_loop', 1).status, 'reached', 'offered repeatable reaches next level');
const crossState = {...state, researched: new Set(), levels: new Map(), alternatives: new Set(['tech_phy'])};
assert.equal(tech.planSearch(crossState, 'tech_eng_target', 3).status, 'reached', 'planner follows cross-area prerequisite');
const reduced = tech.buildReducedPlan(crossState, new Set(['tech_eng_target']));
assert.ok(reduced.nodes.some(node => node.tech.id === 'tech_phy' && node.role === 'offered'), 'reduced plan includes cross-area prerequisite once');
assert.ok(tech.planSearch(crossState, 'tech_eng_target', 3).expanded <= 256, 'search has strict expansion cap');
const simulatedOnce = tech.applySimulation({...state, researched: new Set(), levels: new Map()}, new Set(['tech_loop']), new Map([['tech_loop', 1]]));
assert.equal(simulatedOnce.levels.get('tech_loop'), 1, 'first simulated research has level one, not two');
const simulatedRepeat = tech.applySimulation({...state, researched: new Set(['tech_loop']), levels: new Map([['tech_loop', 4]])}, new Set(['tech_loop']), new Map([['tech_loop', 1]]));
assert.equal(simulatedRepeat.levels.get('tech_loop'), 5, 'existing repeatable increments one level');
const probability = tech.parseDefinitions(['tech_target = { area = physics tier = 0 weight = 100 } tech_a = { area = physics tier = 0 weight = 1000 } tech_b = { area = physics tier = 0 weight = 10000 }'], '0 = { }'); tech._setDefinitions(probability);
const probabilityState = {...state, researched: new Set(), levels: new Map(), alternatives: new Set(['tech_a', 'tech_b'])};
const ranked = tech.recommendation(probabilityState, 'tech_target');
assert.equal(ranked[0].tech.id, 'tech_b', 'recommendation chooses 9.09% target chance over 0.99%');
assert.ok(ranked[0].afterChance > ranked[1].afterChance);
const locked = tech.parseDefinitions(['tech_path = { area = physics tier = 0 weight = 1 } tech_cleanup = { area = physics tier = 0 weight = 1000 } tech_locked_target = { area = physics tier = 0 prerequisites = { tech_path } weight = 100 }'], '0 = { }'); tech._setDefinitions(locked);
const lockedState = {...state, researched: new Set(), levels: new Map(), alternatives: new Set(['tech_path', 'tech_cleanup'])};
const lockedRanked = tech.recommendation(lockedState, 'tech_locked_target');
assert.equal(lockedRanked[0].tech.id, 'tech_path', 'required path outranks cleanup when target is locked');
assert.equal(lockedRanked.find(item => item.tech.id === 'tech_cleanup').afterChance, 0, 'locked target has zero draw probability');
tech._setDefinitions(special);
assert.equal(tech.recommendation({...state, researched:new Set(), levels:new Map(), alternatives:new Set(['tech_event'])}, 'tech_event')[0].tech.id, 'tech_event', 'saved offered special tech remains selectable');
const offeredBlocked = tech.parseDefinitions(['tech_offered_event = { area = physics tier = 0 weight = 0 potential = { has_origin = other_origin } }'], '0 = { }'); tech._setDefinitions(offeredBlocked);
assert.equal(tech.recommendation({...state, origin:'origin_machine', researched:new Set(), levels:new Map(), alternatives:new Set(['tech_offered_event'])}, 'tech_offered_event')[0].tech.id, 'tech_offered_event', 'saved offer overrides special and static impossible state');
const identity = {researched:new Set(), flags:new Set(), modifiers:new Set(), traits:new Set(), ethics:new Set(), civics:new Set(), perks:new Set(), traditions:new Set(), authority:'auth_machine_intelligence', origin:'origin_machine'};
assert.equal(tech.impossibleForCountry({potential:'has_origin = origin_regular'}, identity).impossible, true, 'wrong immutable origin hides tech');
assert.equal(tech.impossibleForCountry({potential:'has_origin = origin_machine'}, identity).impossible, false, 'same origin remains');
assert.equal(tech.impossibleForCountry({potential:'is_regular_empire = yes'}, identity).impossible, true, 'gestalt versus regular hides tech');
assert.equal(tech.impossibleForCountry({potential:'OR = { has_origin = origin_machine has_origin = origin_regular }'}, identity).impossible, false, 'OR keeps possible identity branch');
assert.equal(tech.impossibleForCountry({potential:'any_owned_planet = { is_planet_class = pc_gaia }'}, identity).impossible, false, 'temporary/world unknown remains');
assert.equal(tech.impossibleForCountry({potential:'country_uses_bio_ships = no'}, {...identity, bioShips:true}).impossible, true, 'bio/alloy ship paradigms are exclusive');
tech._setImmutableCivics(new Set(['civic_permanent']));
assert.equal(tech.impossibleForCountry({potential:'has_civic = civic_permanent'}, identity).impossible, true, 'missing immutable civic is impossible');
assert.equal(tech.impossibleForCountry({potential:'has_civic = civic_reformable'}, identity).impossible, false, 'reformable civic remains possible');
assert.equal(tech.impossibleForCountry({potential:'has_ascension_perk = ap_become_the_crisis'}, {...identity, perks:new Set(['ap_cosmogenesis'])}).impossible, true, 'alternate crisis path blocks crisis perk');
assert.equal(tech.impossibleForCountry({potential:'NOR = { has_origin = origin_machine any_owned_planet = { } }'}, identity).impossible, true, 'NOR true/unknown is definitely false');
assert.equal(tech.impossibleForCountry({potential:'NOT = { OR = { has_origin = origin_machine any_owned_planet = { } } }'}, identity).impossible, true, 'NOT true OR unknown is definitely false');
assert.equal(tech.impossibleForCountry({potential:'has_authority = auth_democratic'}, {...identity, authority:'auth_imperial'}).impossible, false, 'regular authority reforms remain possible');
assert.equal(tech.impossibleForCountry({potential:'has_authority = auth_hive_mind'}, {...identity, authority:'auth_machine_intelligence'}).impossible, true, 'machine versus hive is fixed');
const bioPool = tech.parseDefinitions(['tech_bio = { area = physics tier = 0 potential = { country_uses_bio_ships = yes } weight = 1000 } tech_alloy = { area = physics tier = 0 potential = { country_uses_bio_ships = no } weight = 1 }'], '0 = { }'); tech._setDefinitions(bioPool);
assert.equal(tech.recommendation({...identity, bioShips:false, alternatives:new Set(['tech_alloy'])}, 'tech_alloy')[0].totalWeight, 1, 'impossible bio tech does not dilute alloy pool');

const lifecycle = {researched:new Set(), levels:new Map(), alternatives:new Set(['tech_physics_offer', 'tech_society_offer']), alternativesByArea:new Map([['physics', new Set(['tech_physics_offer'])], ['society', new Set(['tech_society_offer'])]]), flags:new Set(), modifiers:new Set(), traits:new Set(), ethics:new Set(), civics:new Set(), perks:new Set(), traditions:new Set(), authority:'', origin:''};
const consumedPhysics = tech.consumeAreaOffers(lifecycle, 'physics');
assert.ok(!consumedPhysics.alternatives.has('tech_physics_offer') && consumedPhysics.alternatives.has('tech_society_offer'), 'consumeAreaOffers clears only researched science offers');
assert.ok(!consumedPhysics.alternativesByArea.has('physics') && consumedPhysics.alternativesByArea.has('society'), 'consumed area no longer exposes its stale saved roll');
const keptOffers = tech.applySimulation(lifecycle, new Set(['tech_physics_offer']), new Map([['tech_physics_offer', 1]]));
assert.ok(keptOffers.alternatives.has('tech_physics_offer') && keptOffers.alternatives.has('tech_society_offer'), 'applySimulation retains original offers for per-area history consumption');

const multi = tech.parseDefinitions([`
tech_path = { area = physics tier = 0 weight = 1 cost = 10 }
tech_pollution = { area = physics tier = 0 weight = 500 cost = 10 }
tech_drawable_but_not_offered = { area = physics tier = 0 weight = 2 cost = 10 }
tech_goal = { area = physics tier = 1 prerequisites = { tech_path } weight = 10 cost = 100 }
tech_cross_goal = { area = engineering tier = 1 prerequisites = { tech_path } weight = 10 }
`], '0 = { } 1 = { previously_unlocked = 0 }');
tech._setDefinitions(multi);
const sideState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(['tech_path', 'tech_pollution']), alternativesByArea:new Map([['physics', new Set(['tech_path', 'tech_pollution'])]])};
const multiReduced = tech.buildReducedPlan(sideState, new Set(['tech_goal', 'tech_cross_goal']));
assert.equal(multiReduced.nodes.filter(node => node.tech.id === 'tech_path').length, 1, 'shared prerequisite is deduplicated across targets');
const promotedTarget = tech.buildReducedPlan(sideState, new Set(['tech_goal', 'tech_path'])).nodes.find(node => node.tech.id === 'tech_path');
assert.equal(promotedTarget.planRole, 'target', 'a target already added as another target prerequisite is promoted to target role');
const sideRank = tech.rankSideChoices(sideState, 'physics', multiReduced);
assert.equal(sideRank[0].tech.id, 'tech_path', 'rankSideChoices prioritizes target path over polluting side choice');
assert.ok(sideRank[0].plan && Number.isFinite(sideRank[0].weightDelta) && Number.isFinite(sideRank[0].effort), 'rankSideChoices exposes plan, pool and effort metrics');
assert.ok(!sideRank.some(item => item.tech.id === 'tech_drawable_but_not_offered'), 'saved offer snapshot limits side choices to cards drawn now');
const rerolledSideRank = tech.rankSideChoices(tech.consumeAreaOffers(sideState, 'physics'), 'physics', multiReduced);
assert.ok(rerolledSideRank.some(item => item.tech.id === 'tech_drawable_but_not_offered'), 'after consuming an area roll, ranking uses the new drawable pool instead of stale offers');
const noOfferState = {...sideState, alternatives:new Set(), alternativesByArea:new Map()};
assert.ok(!tech.rankSideChoices(noOfferState, 'physics', multiReduced).some(item => item.tech.id === 'tech_goal'), 'side choices exclude unmet prerequisite technology without a saved offer');

const cleanup = tech.parseDefinitions([`
tech_light_cleanup = { area = physics tier = 0 weight = 1 cost = 10 }
tech_heavy_cleanup = { area = physics tier = 0 weight = 100 cost = 10 }
`], '0 = { }');
tech._setDefinitions(cleanup);
const cleanupState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(['tech_light_cleanup', 'tech_heavy_cleanup']), alternativesByArea:new Map([['physics', new Set(['tech_light_cleanup', 'tech_heavy_cleanup'])]])};
const cleanupRank = tech.rankSideChoices(cleanupState, 'physics', tech.buildReducedPlan(cleanupState, new Set()));
assert.equal(cleanupRank[0].tech.id, 'tech_heavy_cleanup', 'removing more pool weight is rewarded, not ignored or sign-reversed');

const directTarget = tech.parseDefinitions(['tech_direct_target = { area = physics tier = 0 weight = 1 cost = 10 } tech_direct_noise = { area = physics tier = 0 weight = 1 cost = 10 }'], '0 = { }');
tech._setDefinitions(directTarget);
const directState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(['tech_direct_target', 'tech_direct_noise']), alternativesByArea:new Map([['physics', new Set(['tech_direct_target', 'tech_direct_noise'])]])};
const directRank = tech.rankSideChoices(directState, 'physics', tech.buildReducedPlan(directState, new Set(['tech_direct_target'])));
assert.equal(directRank[0].tech.id, 'tech_direct_target', 'researching an offered target is scored as completion rather than negative exposure');
assert.equal(directRank[0].targetCompletions, 1);
const repeatDirect = tech.parseDefinitions(['tech_repeat_target = { area = physics tier = 0 levels = -1 weight = 1 cost = 10 }'], '0 = { }');
tech._setDefinitions(repeatDirect);
const repeatDirectState = {...lifecycle, researched:new Set(['tech_repeat_target']), levels:new Map([['tech_repeat_target', 4]]), alternatives:new Set(['tech_repeat_target']), alternativesByArea:new Map([['physics', new Set(['tech_repeat_target'])]])};
assert.equal(tech.rankSideChoices(repeatDirectState, 'physics', tech.buildReducedPlan(repeatDirectState, new Set(['tech_repeat_target'])))[0].targetCompletions, 1, 'next repeatable target level counts as target progress');

const recursiveGates = tech.parseDefinitions([`
tech_t1 = { area = physics tier = 1 weight = 1 }
tech_t1_extra = { area = physics tier = 1 weight = 1 }
tech_t2 = { area = physics tier = 2 weight = 1 }
tech_t3_goal = { area = physics tier = 3 weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 } 3 = { previously_unlocked = 1 }');
tech._setDefinitions(recursiveGates);
const recursivePlan = tech.buildReducedPlan({...lifecycle, alternatives:new Set(), alternativesByArea:new Map()}, new Set(['tech_t3_goal']));
assert.ok(recursivePlan.nodes.some(node => node.tech.id === 'tech_t2' && node.role === 'tier-filler'), 'reduced plan adds a previous-tier filler');
assert.ok(recursivePlan.nodes.some(node => /^tech_t1/.test(node.tech.id) && node.role === 'tier-filler'), 'reduced plan recursively closes filler tier gates');
const recursiveAlternativeList = tech.rankFillerAlternatives({...lifecycle, alternatives:new Set(), alternativesByArea:new Map()}, recursivePlan);
assert.ok(recursivePlan.fillerSlots.some(slot => slot.gateTech.id === 'tech_t2'), 'recursive tier gate creates a filler slot for its filler');
assert.ok(recursiveAlternativeList.viableSlotCandidates >= recursiveAlternativeList.items.length, 'recursive filler alternatives retain a full viable-candidate count');

const sixGateSource = [1, 2].flatMap(tier => Array.from({length: 6}, (_, index) => `tech_gate_${tier}_${index} = { area = physics tier = ${tier} weight = 1 cost = 1 }`)).join('\n') + '\ntech_gate_goal = { area = physics tier = 3 weight = 1 cost = 1 }';
const sixGates = tech.parseDefinitions([sixGateSource], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 6 } 3 = { previously_unlocked = 6 }');
tech._setDefinitions(sixGates);
const sixGatePlan = tech.buildReducedPlan({...lifecycle, alternatives:new Set(), alternativesByArea:new Map()}, new Set(['tech_gate_goal']));
assert.equal(sixGatePlan.nodes.filter(node => node.tech.tier === 2).length, 6, 'tier 3 target plans all six required same-area tier 2 technologies');
assert.equal(sixGatePlan.nodes.filter(node => node.tech.tier === 1).length, 6, 'planned tier 2 nodes recursively plan six tier 1 technologies');
assert.equal(sixGatePlan.nodes.length, 13, 'recursive six-tech gates produce a deduplicated planned-node count');
assert.equal(new Set(sixGatePlan.fillerSlots.map(slot => slot.selected.tech.id)).size, 12, 'six-tech recursive gates keep selected filler slots deduplicated');

const fillerCosts = tech.parseDefinitions([`
tech_expensive_filler = { area = physics tier = 1 weight = 100 cost = 1000 }
tech_efficient_filler = { area = physics tier = 1 weight = 1 cost = 5 }
tech_cost_goal = { area = physics tier = 2 weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 }');
tech._setDefinitions(fillerCosts);
const costPlan = tech.buildReducedPlan({...lifecycle, alternatives:new Set(), alternativesByArea:new Map()}, new Set(['tech_cost_goal']));
assert.ok(costPlan.nodes.some(node => node.tech.id === 'tech_efficient_filler'), 'tier filler minimizes cost/pool effort instead of preferring raw draw weight');
assert.ok(!costPlan.nodes.some(node => node.tech.id === 'tech_expensive_filler'), 'expensive high-weight filler is not selected when a cheaper path exists');

const fillerAlternativesSource = tech.parseDefinitions([`
tech_filler_best = { area = physics tier = 1 weight = 1 cost = 2 }
tech_filler_alternative = { area = physics tier = 1 weight = 1 cost = 20 }
tech_filler_repeatable = { area = physics tier = 1 levels = -1 weight = 1 cost = 1 }
tech_filler_event = { area = physics tier = 1 weight = 0 cost = 1 }
tech_filler_wrong_origin = { area = physics tier = 1 potential = { has_origin = origin_other } weight = 1 cost = 1 }
tech_filler_bad_prerequisite = { area = physics tier = 1 prerequisites = { tech_filler_event_prerequisite } weight = 1 cost = 1 }
tech_filler_event_prerequisite = { area = physics tier = 0 weight = 0 cost = 1 }
tech_filler_future = { area = physics tier = 2 prerequisites = { tech_filler_alternative } weight = 10 weight_modifier = { modifier = { factor = 2 has_technology = tech_filler_alternative } } }
tech_filler_researched_future = { area = physics tier = 2 prerequisites = { tech_filler_alternative } weight = 100 }
tech_filler_required = { area = physics tier = 0 weight = 1 cost = 2 }
tech_filler_goal = { area = physics tier = 2 prerequisites = { tech_filler_required } weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 }');
tech._setDefinitions(fillerAlternativesSource);
const fillerAlternativeState = {...lifecycle, origin:'origin_default', researched:new Set(['tech_filler_researched_future']), alternatives:new Set(), alternativesByArea:new Map()};
const fillerAlternativePlan = tech.buildReducedPlan(fillerAlternativeState, new Set(['tech_filler_goal']));
const fillerSlot = fillerAlternativePlan.fillerSlots[0], fillerList = tech.rankFillerAlternatives(fillerAlternativeState, fillerAlternativePlan);
assert.equal(fillerSlot.selected.tech.id, 'tech_filler_best', 'selected tier filler is first by effort score');
assert.ok(fillerAlternativePlan.nodes.some(node => node.tech.id === 'tech_filler_required' && node.planRole === 'prerequisite'), 'reduced tree contains the target hard prerequisite');
assert.ok(fillerSlot.alternatives.every((item, index, list) => index === 0 || list[index - 1].score <= item.score), 'tier filler alternatives are sorted best to worst');
assert.ok(!fillerList.items.some(item => /repeatable|event|wrong_origin|bad_prerequisite/.test(item.tech.id)), 'alternative filler list excludes repeatable, event-only, impossible and impossible-prerequisite techs');
assert.ok(!fillerList.items.some(item => fillerAlternativePlan.nodes.some(node => node.tech.id === item.tech.id)), 'alternative filler list never repeats a selected or otherwise planned technology');
assert.ok(fillerList.items.some(item => item.tech.id === 'tech_filler_alternative' && item.prerequisiteCount === 0 && item.totalCost === 20), 'alternative filler exposes cost and prerequisite effort metrics');
assert.ok(fillerList.items.every(item => Number.isFinite(item.pollutionWeight) && Number.isInteger(item.directFutureCount) && Number.isFinite(item.score)), 'alternative filler exposes future-pool pollution and final score metrics');
const projectedAlternative = fillerList.items.find(item => item.tech.id === 'tech_filler_alternative');
assert.equal(projectedAlternative.directFutureCount, 1, 'future-pool metric excludes already researched dependents');
assert.equal(projectedAlternative.pollutionWeight, 20, 'future-pool metric evaluates weight after the filler path is researched');
assert.equal(new Set(fillerList.items.map(item => item.tech.id)).size, fillerList.items.length, 'alternative filler list deduplicates technology shared by gate slots');
assert.equal(tech.canExcludeTech('tech_filler_best', fillerAlternativeState, fillerAlternativePlan), true, 'selected automatic tier filler can be excluded');
assert.equal(tech.canExcludeTech('tech_filler_goal', fillerAlternativeState, fillerAlternativePlan), false, 'target technology cannot be excluded');
assert.equal(tech.canExcludeTech('tech_filler_required', fillerAlternativeState, fillerAlternativePlan), false, 'hard target prerequisite cannot be excluded');
assert.equal(tech.canExcludeTech('tech_filler_researched_future', fillerAlternativeState, fillerAlternativePlan), false, 'researched technology cannot be excluded');
assert.equal(tech.excludeTech('tech_filler_best', fillerAlternativeState, fillerAlternativePlan), true, 'excluding the preferred filler updates planner state');
const excludedFillerPlan = tech.buildReducedPlan(fillerAlternativeState, new Set(['tech_filler_goal']));
assert.equal(excludedFillerPlan.fillerSlots[0].selected.tech.id, 'tech_filler_alternative', 'excluding best filler selects the next viable filler');
assert.ok(excludedFillerPlan.fillerSlots.every(slot => slot.alternatives.every(item => item.tech.id !== 'tech_filler_best')), 'excluded filler is absent from every gate ranking');
assert.ok(!excludedFillerPlan.nodes.some(node => node.tech.id === 'tech_filler_best'), 'excluded filler is absent from the reduced tree');
assert.ok(!tech.rankFillerAlternatives(fillerAlternativeState, excludedFillerPlan).items.some(item => item.tech.id === 'tech_filler_best'), 'excluded filler is absent from alternative rows');
const excludedSideState = {...fillerAlternativeState, alternatives:new Set(['tech_filler_best', 'tech_filler_alternative']), alternativesByArea:new Map([['physics', new Set(['tech_filler_best', 'tech_filler_alternative'])]])};
assert.ok(!tech.rankSideChoices(excludedSideState, 'physics', excludedFillerPlan).some(item => item.tech.id === 'tech_filler_best'), 'excluded filler is absent from selectable side choices');
assert.ok(!tech.poolImpactByArea(fillerAlternativeState, fillerAlternativeState).byArea.physics.ids.has('tech_filler_best'), 'excluded filler is absent from pool-impact baselines');
const excludedScene = tech.buildExportScene({state:fillerAlternativeState, reduced:excludedFillerPlan, layoutByArea:new Map()});
assert.ok(!excludedScene.cards.some(card => card.id === 'tech_filler_best'), 'excluded filler is absent from PNG scene');
const excludedPlanExport = tech.serializePlan();
assert.equal(excludedPlanExport.version, 3, 'exclusions are serialized in plan v3');
assert.deepEqual(excludedPlanExport.excludedTechs, ['tech_filler_best'], 'plan serialization stores excluded technology IDs');
assert.deepEqual([...tech.validatePlan(JSON.parse(JSON.stringify(excludedPlanExport))).excludedTechs], ['tech_filler_best'], 'v3 plan validation restores exclusions');
const legacyPlan = {...excludedPlanExport, version:2}; delete legacyPlan.excludedTechs;
assert.equal(tech.validatePlan(legacyPlan).excludedTechs.size, 0, 'v2 plans import compatibly without exclusions');
assert.equal(tech.restoreExcludedTech('tech_filler_best'), true, 'restoring exclusion updates planner state');
assert.equal(tech.buildReducedPlan(fillerAlternativeState, new Set(['tech_filler_goal'])).fillerSlots[0].selected.tech.id, 'tech_filler_best', 'restored filler returns as the preferred path');
const currentPoolSource = Array.from({length:12}, (_, index) => `tech_current_draw_${index} = { area = engineering tier = 0 weight = ${index + 1} cost = ${index + 1} }`).join('\n');
const currentPoolDefinitions = tech.parseDefinitions([`
tech_current_tree_base = { area = engineering tier = 0 weight = 1 }
tech_current_tree_target = { area = engineering tier = 0 prerequisites = { tech_current_tree_base } weight = 1 }
tech_current_offered = { area = engineering tier = 0 weight = 2 }
tech_current_event = { area = engineering tier = 0 weight = 0 }
tech_current_locked = { area = engineering tier = 0 prerequisites = { tech_current_missing } weight = 2 }
tech_current_tier_gated = { area = engineering tier = 1 weight = 2 }
tech_current_unavailable = { area = engineering tier = 0 potential = { has_origin = origin_other } weight = 2 }
tech_current_researched = { area = engineering tier = 0 weight = 2 }
${currentPoolSource}
`], '0 = { } 1 = { previously_unlocked = 99 }');
tech._setDefinitions(currentPoolDefinitions);
tech._setPlan({targets:[], excludedTechs:[], simulatedLevels:[], history:[], consumedOfferAreas:[]});
const currentPoolState = {...lifecycle, origin:'origin_default', researched:new Set(['tech_current_tree_base', 'tech_current_researched']), levels:new Map(), alternatives:new Set(['tech_current_offered']), alternativesByArea:new Map([['engineering', new Set(['tech_current_offered'])]])};
const currentPoolPlan = tech.buildReducedPlan(currentPoolState, new Set(['tech_current_tree_target'])), currentPoolImpactCache = new Map(), availableNow = tech.rankAvailableFillers(currentPoolState, 'engineering', currentPoolPlan, currentPoolImpactCache);
assert.equal(currentPoolPlan.fillerSlots.length, 0, 'current drawer fixture has no tier-gate filler slots');
assert.ok(availableNow.length >= 13, 'current off-tree pool is populated even without future filler slots');
assert.ok(availableNow.some(item => item.tech.id === 'tech_current_offered' && item.offeredNow), 'saved current alternative stays in full list with Offered now marker');
assert.ok(availableNow.some(item => item.tech.id === 'tech_current_draw_0' && !item.offeredNow), 'full list also contains non-offered drawable technology');
assert.ok(!availableNow.some(item => /tree_base|tree_target|event|locked|unavailable|researched/.test(item.tech.id)), 'tree, event-only, locked, unavailable and researched techs never appear in current filler list');
assert.ok(!availableNow.some(item => item.tech.id === 'tech_current_tier_gated'), 'technology blocked by its tier gate is absent from the current filler list');
assert.ok(!availableNow.some(item => item.tech.id === 'tech_current_event'), 'literal zero-weight technology is absent from the current filler list');
assert.ok(availableNow.every((item, index, list) => index === 0 || list[index - 1].score >= item.score || (list[index - 1].score === item.score && list[index - 1].tech.id <= item.tech.id)), 'full current filler list has deterministic best-to-worst order');
assert.ok(currentPoolImpactCache.size >= availableNow.length, 'full list stores projected pool impacts for current candidates before final eligibility filtering');
const currentImpactCount = currentPoolImpactCache.size;
const availableNowAgain = tech.rankAvailableFillers(currentPoolState, 'engineering', currentPoolPlan, currentPoolImpactCache);
assert.equal(currentPoolImpactCache.size, currentImpactCount, 'cached projected impacts are reused on an unchanged active area');
assert.equal(tech.excludeTech('tech_current_draw_0', currentPoolState, currentPoolPlan), true, 'drawable off-tree candidate can be excluded');
assert.ok(!tech.rankAvailableFillers(currentPoolState, 'engineering', currentPoolPlan, new Map()).some(item => item.tech.id === 'tech_current_draw_0'), 'excluded candidate disappears from full current filler list');
tech.restoreExcludedTech('tech_current_draw_0');
tech._setDefinitions(fillerAlternativesSource);
tech._setPlan({targets:['tech_filler_goal'], simulatedLevels:[], history:[], consumedOfferAreas:[]});
assert.equal(tech._markResearched('tech_filler_alternative'), true, 'alternative filler Mark researched uses the shared simulation lifecycle');
assert.deepEqual(tech.serializePlan().history, ['tech_filler_alternative'], 'alternative filler research is recorded in history');
assert.deepEqual(tech.serializePlan().simulatedLevels, [['tech_filler_alternative', 1]], 'alternative filler research is persisted as one simulated level');
assert.equal(tech._undoSimulation(), 'tech_filler_alternative', 'Undo removes the latest alternative filler research');
assert.deepEqual(tech.serializePlan().history, [], 'Undo restores empty simulation history');
assert.deepEqual(tech.serializePlan().simulatedLevels, [], 'Undo removes the simulated filler level');
const sharedAcrossSlots = tech.rankFillerAlternatives(fillerAlternativeState, {nodes:fillerAlternativePlan.nodes, fillerSlots:[
  {...fillerSlot, gateTech:{id:'tech_gate_a'}, alternatives:[fillerSlot.selected, projectedAlternative]},
  {...fillerSlot, gateTech:{id:'tech_gate_b'}, alternatives:[fillerSlot.selected, {...projectedAlternative, score:projectedAlternative.score - 1}]}
]});
assert.equal(sharedAcrossSlots.items[0].gates.length, 2, 'deduplication retains every compatible gate when a better duplicate score replaces the row');

const multiFillerDefinitions = tech.parseDefinitions([`
tech_multi_required = { area = physics tier = 0 weight = 1 cost = 1 }
tech_multi_a_prerequisite = { area = physics tier = 0 weight = 1 cost = 1 }
tech_multi_a = { area = physics tier = 1 prerequisites = { tech_multi_a_prerequisite } weight = 1 cost = 1 }
tech_multi_b = { area = physics tier = 1 weight = 1 cost = 10 }
tech_multi_c = { area = physics tier = 1 weight = 1 cost = 20 }
tech_multi_goal = { area = physics tier = 2 prerequisites = { tech_multi_required } weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 2 }');
tech._setDefinitions(multiFillerDefinitions);
tech._setPlan({targets:['tech_multi_goal'], simulatedLevels:[], history:[], consumedOfferAreas:[]});
const multiState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map()};
const multiPlan = tech.buildReducedPlan(multiState, new Set(['tech_multi_goal']));
assert.deepEqual(multiPlan.fillerSlots.map(slot => slot.selected.tech.id), ['tech_multi_a', 'tech_multi_b'], 'multi-slot gate selects distinct fillers');
assert.ok(multiPlan.nodes.some(node => node.tech.id === 'tech_multi_a_prerequisite' && node.planRole === 'prerequisite'), 'selected filler prerequisite is included in the reduced tree');
const multiScene = tech.buildExportScene({state:multiState, reduced:multiPlan, layoutByArea:new Map()});
assert.ok(multiScene.cards.some(card => card.id === 'tech_multi_a') && multiScene.cards.some(card => card.id === 'tech_multi_a_prerequisite'), 'PNG scene includes selected filler and its prerequisite');
assert.ok(multiScene.connections.some(link => link.parentId === 'tech_multi_a_prerequisite' && link.childId === 'tech_multi_a'), 'PNG scene connects selected filler to its prerequisite');
assert.equal(tech.canExcludeTech('tech_multi_required', multiState, multiPlan), false, 'helper rejects exclusion of a hard prerequisite independently from DOM state');
assert.equal(tech.excludeTech('tech_multi_a', multiState, multiPlan), true, 'top filler can be excluded from a multi-slot gate');
const multiExcludedPlan = tech.buildReducedPlan(multiState, new Set(['tech_multi_goal']));
assert.deepEqual(multiExcludedPlan.fillerSlots.map(slot => slot.selected.tech.id), ['tech_multi_b', 'tech_multi_c'], 'excluding top filler fills every deficit with the next distinct candidates');
assert.ok(!multiExcludedPlan.nodes.some(node => node.tech.id === 'tech_multi_a' || node.tech.id === 'tech_multi_a_prerequisite'), 'excluded filler branch is absent from reduced tree and PNG input');
const multiExport = tech.serializePlan();
assert.throws(() => tech.validatePlan({...multiExport, excludedTechs:['tech_multi_goal']}), /conflicts|Invalid/, 'v3 rejects target/exclusion conflicts');
assert.throws(() => tech.validatePlan({...multiExport, excludedTechs:['tech_multi_required']}), /conflicts|Invalid/, 'v3 rejects hard-prerequisite/exclusion conflicts');
assert.throws(() => tech.validatePlan({...multiExport, excludedTechs:['tech_multi_c']}, {...multiState, researched:new Set(['tech_multi_c'])}), /researched|conflicts/, 'v3 rejects exclusions conflicting with current researched technologies');
assert.throws(() => tech.validatePlan({...multiExport, excludedTechs:['tech_multi_c'], simulatedLevels:[['tech_multi_c', 1]], history:['tech_multi_c']}), /conflicts/, 'v3 rejects exclusions conflicting with imported simulation history');
assert.throws(() => tech.validatePlan({...multiExport, version:2}), /v2|Invalid/, 'v2 migration rejects fields that did not exist in the v2 schema');
assert.equal(tech.restoreExcludedTech('tech_multi_a'), true, 'excluded multi-slot filler can be restored');
assert.equal(tech.excludeTech('tech_multi_c', multiState, multiExcludedPlan), true, 'non-required filler can be excluded before simulated research');
assert.equal(tech._markResearched('tech_multi_c'), true, 'manual research accepts a previously excluded non-required filler');
assert.ok(!tech.serializePlan().excludedTechs.includes('tech_multi_c'), 'marking researched removes an obsolete exclusion conflict');
tech._clearPlannerCaches(); let exclusionCacheBuilds = 0;
tech._cachedPlannerModel('exclusion-cache', () => ({build:++exclusionCacheBuilds}));
assert.equal(tech.excludeTech('tech_multi_b', multiState, multiPlan), true, 'another viable filler can be excluded before cache invalidation check');
tech._cachedPlannerModel('exclusion-cache', () => ({build:++exclusionCacheBuilds}));
assert.equal(exclusionCacheBuilds, 2, 'changing exclusions invalidates cached planner snapshots');
assert.equal(tech.clearExcludedTechs(), true, 'Clear exclusions removes a non-empty blacklist');
assert.deepEqual(tech.serializePlan().excludedTechs, [], 'cleared exclusions persist as an empty v3 blacklist');
assert.equal(tech.clearExcludedTechs(), false, 'clearing an already empty blacklist is a no-op');

tech._setDefinitions(fillerCosts);
tech._setPlan({targets:['tech_cost_goal'], simulatedLevels:[['tech_efficient_filler', 1]], history:['tech_efficient_filler'], consumedOfferAreas:['physics']});
const exportedPlan = tech.serializePlan();
const restoredPlan = tech.validatePlan(JSON.parse(JSON.stringify(exportedPlan)));
assert.deepEqual([...restoredPlan.targets], ['tech_cost_goal'], 'v2 plan serialization preserves targets without save data');
assert.equal(restoredPlan.simulatedLevels.get('tech_efficient_filler'), 1, 'v2 plan serialization preserves simulation levels');
assert.throws(() => tech.validatePlan({...exportedPlan, sourceFingerprint:'other-install'}), /Invalid|incompatible/, 'v2 plan rejects a different technology source fingerprint');
assert.throws(() => tech.validatePlan({...exportedPlan, rawSave:'secret'}), /Invalid|incompatible/, 'v2 plan rejects unexpected fields such as raw save data');
assert.throws(() => tech.validatePlan({...exportedPlan, history:[]}), /Invalid simulation history/, 'v2 plan requires history counts to match simulated levels');
assert.throws(() => tech.validatePlan({...exportedPlan, simulatedLevels:[['tech_efficient_filler', 2]], history:['tech_efficient_filler', 'tech_efficient_filler']}), /Invalid simulated technology level/, 'v2 plan rejects repeated simulation of a non-repeatable technology');
tech._setVariables(new Map([['@base', 11], ['@factor', 2], ['@add', 3]]));
assert.throws(() => tech.validatePlan(exportedPlan), /Invalid|incompatible/, 'fingerprint changes with resolved scripted variables');
tech._setVariables(new Map([['@base', 10], ['@factor', 2], ['@add', 3]]));
const alteredCosts = tech.parseDefinitions([`
tech_expensive_filler = { area = physics tier = 1 weight = 100 cost = 1000 }
tech_efficient_filler = { area = physics tier = 1 weight = 1 cost = 6 }
tech_cost_goal = { area = physics tier = 2 weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 }');
tech._setDefinitions(alteredCosts);
assert.throws(() => tech.validatePlan(exportedPlan), /Invalid|incompatible/, 'fingerprint changes when planning-relevant technology data changes');
const layoutInput = [
  {id:'tech_left', tier:0, prerequisites:[]}, {id:'tech_right', tier:0, prerequisites:[]},
  {id:'tech_middle_left', tier:1, prerequisites:['tech_left']}, {id:'tech_middle_right', tier:1, prerequisites:['tech_right']},
  {id:'tech_top', tier:2, prerequisites:['tech_middle_left', 'tech_middle_right']}
];
const layoutA = tech.layoutTree(layoutInput), layoutB = tech.layoutTree([...layoutInput].reverse());
assert.equal(layoutA.positions.get('tech_left').tier < layoutA.positions.get('tech_middle_left').tier, true, 'tree layout keeps prerequisites below dependents');
assert.equal(layoutA.positions.get('tech_middle_left').tier < layoutA.positions.get('tech_top').tier, true, 'tree layout keeps higher-tier dependent above its parents');
assert.deepEqual(layoutA.layers, layoutB.layers, 'tree layout is deterministic regardless of input order');
assert.equal(Math.abs(layoutA.positions.get('tech_middle_left').column - layoutA.positions.get('tech_left').column) <= 1, true, 'barycenter ordering groups connected branches');
const nonMonotonicLayout = tech.layoutTree([
  {id:'tech_same_parent', tier:1, prerequisites:[]},
  {id:'tech_same_child', tier:1, prerequisites:['tech_same_parent']},
  {id:'tech_high_parent', tier:5, prerequisites:[]},
  {id:'tech_low_child', tier:0, prerequisites:['tech_high_parent']}
]);
assert.ok(nonMonotonicLayout.positions.get('tech_same_parent').tier < nonMonotonicLayout.positions.get('tech_same_child').tier, 'same-game-tier prerequisite receives a lower visual DAG layer');
assert.ok(nonMonotonicLayout.positions.get('tech_high_parent').tier < nonMonotonicLayout.positions.get('tech_low_child').tier, 'visual DAG order wins over a reversed game-tier number');
assert.deepEqual(nonMonotonicLayout.layers, tech.layoutTree([...[
  {id:'tech_same_parent', tier:1, prerequisites:[]},
  {id:'tech_same_child', tier:1, prerequisites:['tech_same_parent']},
  {id:'tech_high_parent', tier:5, prerequisites:[]},
  {id:'tech_low_child', tier:0, prerequisites:['tech_high_parent']}
]].reverse()).layers, 'non-monotonic dependency layout remains deterministic');
const crossImpactDefinitions = tech.parseDefinitions([`
tech_phy_best = { area = physics tier = 1 weight = 1 cost = 1 }
tech_phy_cross = { area = physics tier = 1 weight = 1 cost = 3 }
tech_soc_best = { area = society tier = 1 weight = 1 cost = 1 }
tech_soc_alt = { area = society tier = 1 weight = 1 cost = 4 }
tech_phy_gate_goal = { area = physics tier = 2 weight = 1 }
tech_soc_gate_goal = { area = society tier = 2 weight = 1 }
tech_cross_noise = { area = engineering tier = 0 prerequisites = { tech_phy_cross } weight = 90 }
tech_cross_choice = { area = physics tier = 0 weight = 1 cost = 1 }
tech_plain_choice = { area = physics tier = 0 weight = 1 cost = 1 }
tech_side_cross_noise = { area = society tier = 0 prerequisites = { tech_cross_choice } weight = 100 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 1 }');
tech._setDefinitions(crossImpactDefinitions);
const crossImpactState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map(), origin:'origin_default'};
const crossImpactPlan = tech.buildReducedPlan(crossImpactState, new Set(['tech_phy_gate_goal', 'tech_soc_gate_goal']));
const allCrossFillers = tech.rankFillerAlternatives(crossImpactState, crossImpactPlan), physicsFillers = tech.filterFillerAlternatives(allCrossFillers, 'physics'), societyFillers = tech.filterFillerAlternatives(allCrossFillers, 'society');
assert.ok(physicsFillers.items.length && physicsFillers.items.every(item => item.tech.area === 'physics'), 'filler sidebar filter keeps only active physics alternatives');
assert.ok(societyFillers.items.length && societyFillers.items.every(item => item.tech.area === 'society'), 'filler sidebar filter changes with active science tab');
assert.equal(physicsFillers.total, physicsFillers.items.length, 'active science filler count matches the visible filtered list');
assert.equal(physicsFillers.viableSlotCandidates, crossImpactPlan.fillerSlots.filter(slot => slot.gateTech.area === 'physics').reduce((sum, slot) => sum + slot.candidateCount, 0), 'active science viable count excludes slots from other sciences');
const crossFiller = physicsFillers.items.find(item => item.tech.id === 'tech_phy_cross');
assert.ok(crossFiller.crossPoolDelta > 0 && crossFiller.crossWeightDelta > 0, 'cross-area dependent contributes to filler future-pool metrics');
assert.equal(tech.poolImpactByArea(crossImpactState, crossImpactState).totalCountDelta, 0, 'pool impact baseline is stable for identical states');
const sideCrossState = {...crossImpactState, alternatives:new Set(['tech_cross_choice', 'tech_plain_choice']), alternativesByArea:new Map([['physics', new Set(['tech_cross_choice', 'tech_plain_choice'])]])};
const sideCrossRank = tech.rankSideChoices(sideCrossState, 'physics', tech.buildReducedPlan(sideCrossState, new Set()));
const crossChoice = sideCrossRank.find(item => item.tech.id === 'tech_cross_choice'), plainChoice = sideCrossRank.find(item => item.tech.id === 'tech_plain_choice');
assert.ok(crossChoice.crossWeightDelta > 0, 'side choice reports cross-science pool pollution');
assert.ok(plainChoice.score > crossChoice.score, 'cross-science pollution lowers otherwise equal side-choice ranking');

const plannedCrossDefinitions = tech.parseDefinitions([`
tech_planned_cross_choice = { area = physics tier = 0 weight = 1 cost = 1 }
tech_planned_plain_choice = { area = physics tier = 0 weight = 1 cost = 1 }
tech_society_target = { area = society tier = 0 potential = { has_technology = tech_planned_cross_choice } weight = 100 cost = 1 }
`], '0 = { }');
tech._setDefinitions(plannedCrossDefinitions);
const plannedCrossState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(['tech_planned_cross_choice', 'tech_planned_plain_choice']), alternativesByArea:new Map([['physics', new Set(['tech_planned_cross_choice', 'tech_planned_plain_choice'])]])};
const plannedCrossRank = tech.rankSideChoices(plannedCrossState, 'physics', tech.buildReducedPlan(plannedCrossState, new Set(['tech_society_target'])));
const plannedCrossChoice = plannedCrossRank.find(item => item.tech.id === 'tech_planned_cross_choice'), plannedPlainChoice = plannedCrossRank.find(item => item.tech.id === 'tech_planned_plain_choice');
assert.ok(plannedCrossChoice.crossPoolDelta > 0 && plannedCrossChoice.crossWeightDelta > 0, 'physics choice reports the society target added to the future drawable pool');
assert.ok(plannedCrossChoice.score > plannedPlainChoice.score, 'cross-science planned unlock is rewarded instead of treated as pool pollution');
const plannedCrossNoOffers = {...plannedCrossState, alternatives:new Set(), alternativesByArea:new Map()};
const plannedCrossWithoutSavedRoll = tech.rankSideChoices(plannedCrossNoOffers, 'physics', tech.buildReducedPlan(plannedCrossNoOffers, new Set(['tech_society_target']))).find(item => item.tech.id === 'tech_planned_cross_choice');
assert.equal(plannedCrossChoice.crossWeightDelta, plannedCrossWithoutSavedRoll.crossWeightDelta, 'future cross-pool metrics are independent from the current saved offer roll');
assert.equal(plannedCrossChoice.score, plannedCrossWithoutSavedRoll.score, 'side-choice scoring compares the same drawable-pool baseline with and without saved offers');

const projectedBaselineDefinitions = tech.parseDefinitions([`
tech_default_first = { area = physics tier = 1 weight = 1 cost = 1 }
tech_default_second = { area = physics tier = 1 weight = 1 cost = 2 }
tech_cross_alternative = { area = physics tier = 1 weight = 1 cost = 10 }
tech_two_slot_goal = { area = physics tier = 2 weight = 1 cost = 1 }
tech_society_shared_unlock = { area = society tier = 0 potential = { OR = { has_technology = tech_default_first has_technology = tech_cross_alternative } } weight = 1 cost = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 2 }');
tech._setDefinitions(projectedBaselineDefinitions);
const projectedBaselineState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map()};
const projectedBaselinePlan = tech.buildReducedPlan(projectedBaselineState, new Set(['tech_two_slot_goal']));
assert.equal(projectedBaselinePlan.fillerSlots.length, 2, 'tier gate creates both projected filler slots');
assert.equal(projectedBaselinePlan.fillerSlots[0].selected.tech.id, 'tech_default_first', 'first default filler establishes the masking counterexample');
const secondSlotCrossAlternative = projectedBaselinePlan.fillerSlots[1].alternatives.find(item => item.tech.id === 'tech_cross_alternative');
assert.ok(secondSlotCrossAlternative.crossPoolDelta > 0 && secondSlotCrossAlternative.crossWeightDelta > 0, 'later filler alternatives use the current state baseline rather than a previously selected default filler');
const technologyRoot = path.join(gameRoot, 'common', 'technology');
const localTechnologyFiles = fs.readdirSync(technologyRoot, {recursive:true}).filter(file => file.endsWith('.txt') && !/(^|[\\/])(tier|category)[\\/]/.test(file));
const localTechnologySources = localTechnologyFiles.map(file => fs.readFileSync(path.join(technologyRoot, file), 'utf8'));
const localTierSource = fs.readFileSync(path.join(technologyRoot, 'tier', '00_tier.txt'), 'utf8');
const nomadDefinitions = tech.parseDefinitions([...localTechnologySources, 'tech_nomad_compatible = { area = society tier = 1 potential = { is_nomadic = yes } weight = 1 }'], localTierSource);
tech._setDefinitions(nomadDefinitions);
const nomadState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map(), isNomadic:true, countryType:'default'};
for (const id of ['tech_dense_jungle', 'tech_quicksand_basin', 'tech_noxious_swamp', 'tech_massive_glacier', 'tech_toxic_kelp']) assert.equal(tech.impossibleForCountry(nomadDefinitions.byId.get(id), nomadState).impossible, true, `${id} is excluded for a nomadic empire by its local is_nomadic condition`);
const actualNonNomadTechs = [...nomadDefinitions.byId.values()].filter(item => /\bis_nomadic\s*=\s*no\b/.test(item.potential));
assert.ok(actualNonNomadTechs.length >= 20, 'local 4.5 definitions provide a broad real is_nomadic=no regression sample');
assert.ok(actualNonNomadTechs.every(item => tech.impossibleForCountry(item, nomadState).impossible), 'every local potential with is_nomadic=no is excluded without a technology-name blacklist');
assert.equal(tech.impossibleForCountry(nomadDefinitions.byId.get('tech_nomad_compatible'), nomadState).impossible, false, 'nomad-compatible society technology remains visible');
assert.equal(tech.impossibleForCountry({potential:'any_owned_planet = { has_deposit = d_dense_jungle }'}, nomadState).impossible, true, 'nomad colony-only gate is a permanent incompatibility');
assert.equal(tech.impossibleForCountry({potential:'has_technology = tech_future'}, nomadState).impossible, false, 'temporary missing technology remains unknown and is not permanently hidden');
const perfTargets = new Set([...nomadDefinitions.byId.values()].filter(item => item.tier >= 4 && !item.eventOnly).slice(0, 4).map(item => item.id));
const perfStarted = Date.now(), perfPlan = tech.buildReducedPlan(nomadState, perfTargets);
for (const science of ['physics', 'society', 'engineering']) tech.rankSideChoices(nomadState, science, perfPlan);
const perfElapsed = Date.now() - perfStarted;
assert.ok(perfElapsed < 5000, `cold local 678-tech plan should remain interactive, took ${perfElapsed}ms`);
const coordinateLayout = tech.layoutTree([
  {id:'tech_single_parent', tier:0, prerequisites:[]}, {id:'tech_two_child_parent', tier:0, prerequisites:[]},
  {id:'tech_single_child', tier:1, prerequisites:['tech_single_parent']}, {id:'tech_left_child', tier:1, prerequisites:['tech_two_child_parent']}, {id:'tech_right_child', tier:1, prerequisites:['tech_two_child_parent']}
]);
assert.equal(coordinateLayout.positions.get('tech_single_parent').x, coordinateLayout.positions.get('tech_single_child').x, 'single-child prerequisite aligns directly below its child');
assert.equal(coordinateLayout.positions.get('tech_two_child_parent').x, (coordinateLayout.positions.get('tech_left_child').x + coordinateLayout.positions.get('tech_right_child').x) / 2, 'shared prerequisite centers between immediate children');
for (const layer of coordinateLayout.layers) { const xs = layer.ids.map(id => coordinateLayout.positions.get(id).x).sort((a, b) => a - b); assert.ok(xs.every((x, index) => index === 0 || x - xs[index - 1] >= 204), 'coordinate layout prevents cards on the same layer from overlapping'); }
assert.ok(coordinateLayout.positions.get('tech_single_parent').tier < coordinateLayout.positions.get('tech_single_child').tier, 'coordinate layout keeps prerequisite below dependent');
const sharedParentsLayout = tech.layoutTree([
  {id:'tech_parent_a', tier:0, prerequisites:[]}, {id:'tech_parent_b', tier:0, prerequisites:[]},
  {id:'tech_child_a', tier:1, prerequisites:['tech_parent_a', 'tech_parent_b']}, {id:'tech_child_b', tier:1, prerequisites:['tech_parent_a', 'tech_parent_b']}
]);
const sharedChildXs = ['tech_child_a', 'tech_child_b'].map(id => sharedParentsLayout.positions.get(id).x), sharedMinimum = Math.min(...sharedChildXs), sharedMaximum = Math.max(...sharedChildXs);
for (const id of ['tech_parent_a', 'tech_parent_b']) assert.ok(sharedParentsLayout.positions.get(id).x >= sharedMinimum && sharedParentsLayout.positions.get(id).x <= sharedMaximum, 'colliding shared prerequisites stay distributed beneath/between their children');
const sharedParentXs = ['tech_parent_a', 'tech_parent_b'].map(id => sharedParentsLayout.positions.get(id).x).sort((a, b) => a - b);
assert.ok(sharedParentXs[1] - sharedParentXs[0] >= 204, 'centered shared prerequisites still do not overlap');
const gateAwareLayout = tech.layoutTree([
  {id:'tech_gate_left', tier:0, prerequisites:[]}, {id:'tech_gate_filler', tier:0, prerequisites:[]}, {id:'tech_gate_right', tier:0, prerequisites:[]},
  {id:'tech_gate_target', tier:1, prerequisites:['tech_gate_right']}
], [{from:'tech_gate_filler', to:'tech_gate_target'}]);
assert.ok(Math.abs(gateAwareLayout.positions.get('tech_gate_filler').x - gateAwareLayout.positions.get('tech_gate_target').x) < Math.abs(gateAwareLayout.positions.get('tech_gate_left').x - gateAwareLayout.positions.get('tech_gate_target').x), 'tier filler is arranged beside its gate target instead of an unrelated branch');
assert.deepEqual(gateAwareLayout.layers, tech.layoutTree([
  {id:'tech_gate_target', tier:1, prerequisites:['tech_gate_right']}, {id:'tech_gate_right', tier:0, prerequisites:[]},
  {id:'tech_gate_filler', tier:0, prerequisites:[]}, {id:'tech_gate_left', tier:0, prerequisites:[]}
], [{from:'tech_gate_filler', to:'tech_gate_target'}]).layers, 'gate-aware layout remains deterministic');
const crossingFixture = tech.layoutTree([
  {id:'n00', tier:0, prerequisites:[]}, {id:'n01', tier:0, prerequisites:[]}, {id:'n02', tier:0, prerequisites:[]}, {id:'n03', tier:0, prerequisites:[]},
  {id:'n10', tier:1, prerequisites:['n00', 'n01']}, {id:'n11', tier:1, prerequisites:['n00', 'n01']}, {id:'n12', tier:1, prerequisites:['n00', 'n02']}, {id:'n13', tier:1, prerequisites:['n02']},
  {id:'n20', tier:2, prerequisites:['n11']}, {id:'n21', tier:2, prerequisites:['n10', 'n11', 'n12', 'n13']}, {id:'n22', tier:2, prerequisites:['n11', 'n12']}, {id:'n23', tier:2, prerequisites:['n10', 'n11']},
  {id:'n30', tier:3, prerequisites:[]}, {id:'n31', tier:3, prerequisites:['n21', 'n22', 'n11']}, {id:'n32', tier:3, prerequisites:['n20', 'n23', 'n13']}, {id:'n33', tier:3, prerequisites:['n20', 'n22', 'n11']}
]);
assert.ok(crossingFixture.crossings < crossingFixture.initialCrossings, 'local swap pass removes crossings left by barycentric ordering, including long-span links');
assert.deepEqual([crossingFixture.layers, crossingFixture.crossings], (() => { const reversed = tech.layoutTree([
  {id:'n00', tier:0, prerequisites:[]}, {id:'n01', tier:0, prerequisites:[]}, {id:'n02', tier:0, prerequisites:[]}, {id:'n03', tier:0, prerequisites:[]},
  {id:'n10', tier:1, prerequisites:['n00', 'n01']}, {id:'n11', tier:1, prerequisites:['n00', 'n01']}, {id:'n12', tier:1, prerequisites:['n00', 'n02']}, {id:'n13', tier:1, prerequisites:['n02']},
  {id:'n20', tier:2, prerequisites:['n11']}, {id:'n21', tier:2, prerequisites:['n10', 'n11', 'n12', 'n13']}, {id:'n22', tier:2, prerequisites:['n11', 'n12']}, {id:'n23', tier:2, prerequisites:['n10', 'n11']},
  {id:'n30', tier:3, prerequisites:[]}, {id:'n31', tier:3, prerequisites:['n21', 'n22', 'n11']}, {id:'n32', tier:3, prerequisites:['n20', 'n23', 'n13']}, {id:'n33', tier:3, prerequisites:['n20', 'n22', 'n11']}
].reverse()); return [reversed.layers, reversed.crossings]; })(), 'crossing optimization is deterministic regardless of input order');
const gateProgressDefinitions = tech.parseDefinitions([`
tech_gate_researched = { area = physics tier = 1 weight = 1 }
tech_gate_required = { area = physics tier = 1 weight = 1 }
tech_gate_filler = { area = physics tier = 1 weight = 1 }
tech_gate_target = { area = physics tier = 2 prerequisites = { tech_gate_filler } weight = 1 }
`], '0 = { } 1 = { previously_unlocked = 0 } 2 = { previously_unlocked = 3 }');
tech._setDefinitions(gateProgressDefinitions);
const gateProgressState = {...lifecycle, researched:new Set(['tech_gate_researched']), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map()};
const gateFiller = {tech:gateProgressDefinitions.byId.get('tech_gate_filler')}, gateTarget = gateProgressDefinitions.byId.get('tech_gate_target');
const gateProgressReduced = {nodes:[
  {tech:gateProgressDefinitions.byId.get('tech_gate_required'), planRole:'prerequisite'},
  {tech:gateFiller.tech, planRole:'tier-filler'},
  {tech:gateTarget, planRole:'target'}
], fillerSlots:[{gateTech:gateTarget, tier:2, selected:gateFiller}, {gateTech:gateTarget, tier:2, selected:gateFiller}]};
const gateSummary = tech.gateProgress(gateProgressState, gateProgressReduced, 'physics');
assert.deepEqual(gateSummary.map(item => [item.tier, item.researched, item.planned, item.fillers, item.total, item.missing]), [[2, 1, 2, 1, 3, 0]], 'tier-gate progress counts researched and planned unique IDs once, including a filler only once');
assert.deepEqual(tech.unifiedGateProgress(gateProgressState, gateProgressReduced).map(item => [item.area, item.tier, item.total, item.gate]), [['physics', 2, 3, 3]], 'unified live-tree gate summary keeps the research area on every gate');
assert.deepEqual(tech.plannedNodeEffects(gateProgressReduced.nodes[1], gateProgressReduced, gateProgressState), {children:['tech_gate_target'], gateTiers:[2]}, 'filler and prerequisite effects coexist on one technology');
const exportDefinitions = tech.parseDefinitions([`
tech_export_phy_base = { area = physics tier = 0 weight = 1 cost = 10 }
tech_export_phy_target = { area = physics tier = 1 prerequisites = { tech_export_phy_base } category = { particles } is_rare = yes weight = 1 cost = 20 }
tech_export_soc_base = { area = society tier = 0 weight = 1 cost = 11 }
tech_export_soc_target = { area = society tier = 1 prerequisites = { tech_export_soc_base tech_export_phy_base } weight = 1 cost = 21 }
tech_export_eng_base = { area = engineering tier = 0 weight = 1 cost = 12 }
tech_export_eng_target = { area = engineering tier = 1 prerequisites = { tech_export_eng_base } category = { voidcraft } is_rare = yes is_dangerous = yes weight = 1 cost = 22 }
`], '0 = { } 1 = { previously_unlocked = 0 }');
tech._setDefinitions(exportDefinitions);
const exportState = {...lifecycle, researched:new Set(), levels:new Map(), alternatives:new Set(), alternativesByArea:new Map()};
const exportReduced = tech.buildReducedPlan(exportState, new Set(['tech_export_phy_target', 'tech_export_soc_target', 'tech_export_eng_target']));
const exportModel = {state:exportState, reduced:exportReduced, layoutByArea:new Map()};
const exportScene = tech.buildExportScene(exportModel), exportSceneAgain = tech.buildExportScene(exportModel);
assert.deepEqual(exportScene.areas.map(section => section.area), ['all'], 'PNG объединяет все науки в одну секцию дерева');
assert.equal(exportScene.cards.length, 6, 'PNG scene contains every planned card from each area');
assert.equal('fillers' in exportScene, false, 'PNG scene deliberately excludes alternative filler sidebar data');
assert.ok(exportScene.cards.every(card => card.x >= 0 && card.y >= 0 && card.x + card.width <= exportScene.width && card.y + card.height <= exportScene.height), 'PNG scene bounds contain every card');
assert.ok(exportScene.connections.every(link => [link.from, link.to].every(point => point.x >= 0 && point.y >= 0 && point.x <= exportScene.width && point.y <= exportScene.height)), 'PNG scene bounds contain every connector endpoint');
assert.ok(exportScene.connections.some(link => link.crossArea && link.parentId === 'tech_export_phy_base' && link.childId === 'tech_export_soc_target'), 'PNG scene retains cross-science prerequisite connectors');
const exportedPhysicsBase = exportScene.cards.find(card => card.id === 'tech_export_phy_base'), exportedSocietyTarget = exportScene.cards.find(card => card.id === 'tech_export_soc_target');
assert.ok(exportedPhysicsBase.y > exportedSocietyTarget.y, 'межнаучная prerequisite располагается в общей ветке ниже зависимой технологии');
assert.ok(exportScene.areas.every(section => Array.isArray(section.gates)), 'PNG scene includes tier-gate summaries for the unified tree');
assert.ok(exportScene.cards.every(card => card.effects && Array.isArray(card.effects.children) && Array.isArray(card.effects.gateTiers)), 'PNG cards retain downstream-effect metadata');
assert.deepEqual([exportScene.width, exportScene.height, exportScene.areas.map(section => [section.area, section.x, section.y, section.width, section.height])], [exportSceneAgain.width, exportSceneAgain.height, exportSceneAgain.areas.map(section => [section.area, section.x, section.y, section.width, section.height])], 'PNG scene dimensions and section placement are deterministic');
assert.ok(tech.exportScale(exportScene) > 0 && tech.exportScale(exportScene) <= 2, 'PNG scale remains within safe deterministic limits');
const hugeExportScale = tech.exportScale({width:20000, height:12000});
assert.ok(Math.ceil(20000 * hugeExportScale) <= 8192 && Math.ceil(12000 * hugeExportScale) <= 8192 && Math.ceil(20000 * hugeExportScale) * Math.ceil(12000 * hugeExportScale) <= 17 * 1024 * 1024, 'PNG scale caps dimensions and memory for oversized plans');
const wrappedLines = [], textContext = {measureText:value => ({width:String(value).length * 8}), fillText:value => wrappedLines.push(value)};
tech.exportText(textContext, 'UnbrokenExtremelyLongTechnologyLocalizationName', 0, 0, 80, 2);
assert.ok(wrappedLines.length <= 2 && wrappedLines.every(line => textContext.measureText(line).width <= 80), 'PNG card text clamps unbroken localization without clipping');
const drawnText = [], cardFills = new Map(), sceneContext = {fillStyle:'', strokeStyle:'', font:'', lineWidth:1, fillRect(x, y, width, height){ if (exportScene.cards.some(card => card.x === x && card.y === y && card.width === width && card.height === height)) cardFills.set(`${x}:${y}`, this.fillStyle); }, strokeRect(){}, beginPath(){}, moveTo(){}, bezierCurveTo(...args){ assert.equal(args.length, 6, 'PNG connectors use a valid cubic Bézier'); }, stroke(){}, setLineDash(){}, drawImage(){}, measureText:value => ({width:String(value).length * 7}), fillText:value => drawnText.push(String(value))};
tech.drawExportScene(sceneContext, exportScene);
assert.equal(cardFills.get(`${exportScene.cards.find(card => card.id === 'tech_export_phy_target').x}:${exportScene.cards.find(card => card.id === 'tech_export_phy_target').y}`), '#251838', 'PNG окрашивает всю редкую карточку');
assert.equal(cardFills.get(`${exportScene.cards.find(card => card.id === 'tech_export_eng_target').x}:${exportScene.cards.find(card => card.id === 'tech_export_eng_target').y}`), '#301418', 'PNG окрашивает всю опасную карточку');
assert.ok(drawnText.includes('Technology tree'), 'PNG renderer draws the unified tree heading');
assert.ok(drawnText.some(value => /green = prerequisite/.test(value)), 'PNG renderer explains connection colours');
assert.ok(drawnText.some(value => /Required by 1 planned node/.test(value)), 'PNG describes dependency without claiming the child is immediately unlocked');
assert.ok(drawnText.some(value => /^Weight /.test(value)), 'PNG puts weight on a separate readable line');
assert.ok(!drawnText.some(value => /Alternative fillers|Mark researched|Export PNG/.test(value)), 'PNG renderer excludes filler alternatives and UI controls');
const emptyExportScene = tech.buildExportScene({state:exportState, reduced:{nodes:[], fillerSlots:[], targets:[], incomplete:[]}, layoutByArea:new Map()});
assert.deepEqual(emptyExportScene.areas.map(section => section.area), ['all'], 'empty PNG keeps one labelled unified tree');
assert.equal(emptyExportScene.cards.length, 0, 'empty PNG does not invent technology cards');
assert.doesNotThrow(() => tech.drawExportScene(sceneContext, emptyExportScene), 'empty target PNG still renders the unified tree');
const inspectorCss = fs.readFileSync(path.join(__dirname, 'inspector.css'), 'utf8'), inspectorHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const technologyJs = fs.readFileSync(path.join(__dirname, 'technology.js'), 'utf8');
assert.match(inspectorCss, /body\.technologies-active \.shell/, 'wide inspector shell is scoped to Technologies only');
assert.match(inspectorHtml, /technologies-active/, 'page switch toggles the scoped Technologies wide mode');
assert.match(technologyJs, /function renderUnifiedTree\(tree, model\)/, 'main screen renders one unified live technology tree');
assert.match(technologyJs, /model\.unifiedLayout \|\| layoutTree\(reduced\.nodes, gateLayoutLinks\(reduced\)\)/, 'live tree caches one cross-science layout in the planner model');
assert.match(technologyJs, /if \(tree\.dataset\.plannerKey === model\.key\) return;/, 'science tabs do not rebuild the live tree when the planner snapshot is unchanged');
assert.match(technologyJs, /tech-cross-area-link/, 'live connector renderer marks cross-science dependencies');
tech._clearPlannerCaches();
let plannerFactoryCalls = 0;
const firstTabModel = tech._cachedPlannerModel('empire:stable-plan', () => ({id: ++plannerFactoryCalls}));
const switchedTabModel = tech._cachedPlannerModel('empire:stable-plan', () => ({id: ++plannerFactoryCalls}));
assert.equal(firstTabModel, switchedTabModel, 'science tab switch reuses the same cached planner snapshot');
assert.equal(plannerFactoryCalls, 1, 'science tab switch does not rebuild planner model');
tech._clearPlannerCaches();
const afterResearchModel = tech._cachedPlannerModel('empire:simulated-tech', () => ({id: ++plannerFactoryCalls}));
assert.notEqual(afterResearchModel, firstTabModel, 'simulated research invalidates only the planner snapshot key');
assert.equal(plannerFactoryCalls, 2, 'research selection triggers one new planner snapshot build');
console.log('technology-tests: ok');
