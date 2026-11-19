"""Gate tests: a model that learned real signal passes; noise stays off.

    python3 -m unittest test_train.py
"""

import random
import unittest

from train import build_manifest, ladder_class


def synth(n, signal=True, seed=1):
    rng = random.Random(seed)
    rows = []
    for _ in range(n):
        # Centering drives the grade (like real PSA results); noise otherwise.
        worst = rng.uniform(50, 72)
        if signal:
            g = 10 if worst <= 54 else 9 if worst <= 59 else 8 if worst <= 64 else 7
            if rng.random() < 0.15:
                g = max(6, g - 1)
        else:
            g = rng.choice([10, 9, 8, 7])
        f = [worst, rng.uniform(50, 58), rng.uniform(50, 75), rng.uniform(50, 75),
             rng.uniform(3, 6), rng.uniform(3, 6), rng.uniform(0, 0.03), rng.uniform(0, 0.03),
             rng.choice([0, 8, 16]), rng.choice([0, 1, 2]), rng.choice([0, 1])]
        rows.append({"grader": "PSA", "grade": str(g), "features": f})
    return rows


class GateTest(unittest.TestCase):
    def test_ladder(self):
        self.assertEqual(ladder_class("PSA", "10"), 0)
        self.assertEqual(ladder_class("PSA", "9"), 1)
        self.assertEqual(ladder_class("PSA", "6"), 3)
        self.assertEqual(ladder_class("BGS", "9.5"), 1)

    def test_real_signal_turns_odds_on(self):
        m = build_manifest(synth(600, signal=True))
        self.assertTrue(m["report"]["PSA"]["passed"], m["report"]["PSA"])
        self.assertTrue(m["enabled"])
        self.assertIn("PSA", m["graders"])
        self.assertEqual(len(m["graders"]["PSA"]["W"]), 4)

    def test_noise_keeps_odds_off(self):
        m = build_manifest(synth(600, signal=False))
        self.assertFalse(m["report"]["PSA"]["passed"])
        self.assertFalse(m["enabled"])

    def test_too_few_results(self):
        m = build_manifest(synth(100))
        self.assertFalse(m["enabled"])
        self.assertIn("need 150", m["report"]["PSA"]["reason"])


if __name__ == "__main__":
    unittest.main()
