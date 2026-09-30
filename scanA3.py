import io
p = open(r'C:\Users\ABC Informatique\AppData\Local\Temp\stahlA.txt', encoding='utf-8').read()
i = p.find('Bela')
with io.open('scanA3.txt', 'w', encoding='utf-8') as f:
    f.write('context: %s\n' % p[i-10:i+20].encode('unicode_escape').decode('ascii'))
print('done')
