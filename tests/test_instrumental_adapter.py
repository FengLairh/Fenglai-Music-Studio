import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from instrumental_adapter import prepare_instrumental, TOOLS
sys.path.insert(0,str(TOOLS))
from abc_tools import parse_abc

class AdapterTest(unittest.TestCase):
    def test_reference_and_planning(self):
        abc='X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=80\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n% verse\nV: Vocal\nC8 D8 E8 G8|\nV: Ins\nZ|'
        class Plan:
            truncated=False
            def save(self,d): d.mkdir(parents=True);(d/'score.abc').write_text(self.abc)
        plan=Plan();plan.abc=abc
        class Pipe:
            tokenizer=type('Tokenizer',(),{'encode':lambda self,text:[0]*100})()
            calls=0
            def plan(self,**kw): self.calls+=1;return plan
        for reference in (abc,''):
            pipe=Pipe()
            with tempfile.TemporaryDirectory() as d:
                r=prepare_instrumental(pipe,dict(style='piano',abc=reference,seed=42,keepHarmony=True,lyrics='DO NOT SING'),Path(d),lambda *a,**k:None)
                self.assertNotIn('DO NOT SING',r['lyrics']);self.assertEqual(pipe.calls,0 if reference else 1)
                score=parse_abc(r['abc']);self.assertFalse(score.voices['Vocal'].notes);self.assertTrue(score.voices['Ins'].notes)
                self.assertTrue((Path(d)/'instrumental-transfer.json').exists())
if __name__=='__main__':unittest.main()
