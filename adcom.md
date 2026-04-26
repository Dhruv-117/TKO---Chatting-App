**PCM:**

clc;

n = 16;

n1 = 8;

L = 2^n;

x = 0:2\*pi/n1:4\*pi;

s = 8\*sin(x);

subplot(3,1,1);

plot(s);

title('Analog Signal');

ylabel('Amplitude');

xlabel('Time');

subplot(3,1,2);

stem(s);

grid on;

title('Sample Signal');

ylabel('amplitude');

xlabel('time');

%

vmax = 8;

vmin = -vmax;

del = (vmax-vmin)/L;

part = vmin:del:vmax;

code = vmin - (del/2): del:vmax+(del/2);

\[ind,q]=quantiz(s,part,code);

l1=length(ind);

l2=length(q);

for i=1:l1

if(ind(i)\~=0)

ind(i)=ind(i)-1;

end

i = i+1;

end

for i = 1:l2

if(q(i)==vmin-(del/2))

q(i)==vmin+(del/2);

end

end

subplot(3,1,3);

stem(q);

grid on;

title('Quantized Signal');

ylabel('Amplitude');

xlabel('Time');

% Encoded

figure

code=de2bi(ind,'left-msb');

k = 1;

for i=1:l1

for j = 1:n

coded(k)=code(i,j);



j=j+1;

k=k+1;

end

i=i+1;

end

subplot(2,1,1);

grid on;

stairs(coded);

axis(\[0 100 -2 3]);

title('Encoded Signal');

ylabel('Amplitude');

xlabel('Time');

% Demodulation

qunt = reshape(coded,n,length(coded)/n);

index = bi2de(qunt','left-msb');

q=del\*index+vmin+(del/2);

subplot(2,1,2);

grid on;

plot(q);

title('Demodulated Signal');

ylabel('Amplitude');

xlabel('Time');



**DM:**

clc;

clear all;

a = 2;

t =0:2\*pi/50:2\*pi;

x=a\*sin(t);

l = length(x);

plot(x,'r','Linewidth',1.9);

delta = 0.2;

hold on

xn=0;

for i=1:l

if(x(i)>xn(i))

d(i)=1;

xn(i+1)=xn(i)+delta;

else d(i)=0;

xn(i+1)=xn(i)-delta;

end

end

stairs(xn,'k','LineWidth',1.5);

hold on

for i=1:d

if d(i)>xn(i)

d(i)=0;

xn(i+1)=xn(i)-delta;

else d(i)=1;

xn(i+1)=xn(i)+delta;

end



end

plot(xn,'b','Linewidth',1.7);

legend('Original Signal','Delta Modulated Signal','Recovered Signal');



**ADM:**

clc;

clear all;

close all;



% Input Signals, m(t).

t = 0 : 2\*pi/100 : 2\*pi;

mt = sin(t) + 2; % Sine wave with non-zero DC value.



% Step Size, S.

quantizationLevels = 3;

S = (max(mt) - min(mt)) / quantizationLevels;



% Modulate.

totalSamples = length(mt);   % FIXED

mqt = zeros(1, totalSamples); % FIXED

dk = zeros(1, totalSamples);

dt = 0;

Sk = zeros(1, totalSamples);



% Initial conditions (FIXED)

mqt(1) = mt(1);

Sk(1) = S;



for n = 2 : totalSamples-1   % keep your structure

&#x20;   dt = mt(n) - mqt(n);

&#x20;   

&#x20;   if(dt >= 0)

&#x20;       dk(n) = 1;

&#x20;   else

&#x20;       dk(n) = -1;

&#x20;   end

&#x20;   

&#x20;   Sk(n) = abs(Sk(n-1))\*dk(n) + S\*dk(n-1);

&#x20;   mqt(n+1) = mqt(n) + Sk(n);

end



% Display Modulation Result.

plot(t, mt,'r','LineWidth',2);

hold on;

stairs(t, mqt,'k','LineWidth',2);

axis(\[t(1) t(end) (min(min(mqt), min(mt)) - 0.5) ...

&#x20;     (max(max(mqt), max(mt)) + 0.5)]);

title('Adaptive Delta Modulation', 'Fontsize', 14);

xlabel('Time');

ylabel('Amplitude');

legend('Input Signal, m(t)', 'Modulated Signal, m\_q(t)');

grid on;



**ASK/PSK/FSK:**

clc;

close all;

clear all;

n=10; % length of bit stream

b=\[1 0 0 1 1 1 0 0 0 1]



f1=1;f2=2;

t=0:1/30:1-1/30;

%ASK

sa1=sin(2\*pi\*f1\*t);

E1=sum(sa1.^2);

sa1=sa1/sqrt(E1); %unit energy

sa0=0\*sin(2\*pi\*f1\*t);

%FSK

sf0=sin(2\*pi\*f1\*t);

E0=sum(sf0.^2);

sf0=sf0/sqrt(E0);

sf1=sin(2\*pi\*f2\*t);

E1=sum(sf1.^2);

sf1=sf1/sqrt(E1);

%PSK

sp=sin(2\*pi\*f1\*t);

E1=sum(sp.^2);

sp0=-sin(2\*pi\*f1\*t)/sqrt(E1);

sp1=sin(2\*pi\*f1\*t)/sqrt(E1);

%MODULATION

ask=\[];psk=\[];fsk=\[];

for i=1:n

if b(i)==1

ask=\[ask sa1];

psk=\[psk sp1];

fsk=\[fsk sf1];

else

ask=\[ask sa0];

psk=\[psk sp0];

fsk=\[fsk sf0];

end

end

figure(1)

subplot(411)

stairs(0:10,\[b(1:10) b(10)],'linewidth',1.5)

axis(\[0 10 -0.5 1.5])

title('Message Bits');grid on

xlabel('Time');ylabel('Amplitude')

subplot(412)

tb=0:1/30:10-1/30;

plot(tb, ask(1:10\*30),'b','linewidth',1.5)

title('ASK Modulation');grid on

xlabel('Time');ylabel('Amplitude')

subplot(413)

plot(tb, fsk(1:10\*30),'r','linewidth',1.5)

title('FSK Modulation');grid on

xlabel('Time');ylabel('Amplitude')

subplot(414)

plot(tb, psk(1:10\*30),'k','linewidth',1.5)

title('PSK Modulation');grid on

xlabel('Time');ylabel('Amplitude')



**Line Coding:**

clc;

clear;

close all;



bits = \[1 0 1 0 0 0 1 1 0];

bitrate = 1; % bits per second



figure;



\[t,s] = unrz(bits,bitrate);

subplot(4,1,1);

plot(t,s,'LineWidth',3);

axis(\[0 t(end) -0.1 1.1])

grid on;

title(\['Unipolar NRZ: \[' num2str(bits) ']']);



\[t,s] = urz(bits,bitrate);

subplot(4,1,2);

plot(t,s,'LineWidth',3);

axis(\[0 t(end) -0.1 1.1])

grid on;

title(\['Unipolar RZ: \[' num2str(bits) ']']);



\[t,s] = prz(bits,bitrate);

subplot(4,1,3);

plot(t,s,'LineWidth',3);

axis(\[0 t(end) -1.1 1.1])

grid on;

title(\['Polar RZ: \[' num2str(bits) ']']);



\[t,s] = manchester(bits,bitrate);

subplot(4,1,4);

plot(t,s,'LineWidth',3);

axis(\[0 t(end) -1.1 1.1])

grid on;

title(\['Manchester: \[' num2str(bits) ']']);



%% FUNCTIONS



function \[t,s] = unrz(bits, bitrate)

Tb = 1/bitrate;

samples = 100;

t = 0:Tb/samples:Tb\*length(bits);

s = zeros(size(t));



for i = 1:length(bits)

&#x20;   idx = (t >= (i-1)\*Tb) \& (t < i\*Tb);

&#x20;   s(idx) = bits(i);

end

end



function \[t,s] = urz(bits, bitrate)

Tb = 1/bitrate;

samples = 100;

t = 0:Tb/samples:Tb\*length(bits);

s = zeros(size(t));



for i = 1:length(bits)

&#x20;   idx1 = (t >= (i-1)\*Tb) \& (t < (i-0.5)\*Tb);

&#x20;   

&#x20;   if bits(i) == 1

&#x20;       s(idx1) = 1;

&#x20;   end

end

end



function \[t,s] = prz(bits, bitrate)

Tb = 1/bitrate;

samples = 100;

t = 0:Tb/samples:Tb\*length(bits);

s = zeros(size(t));



for i = 1:length(bits)

&#x20;   idx1 = (t >= (i-1)\*Tb) \& (t < (i-0.5)\*Tb);



&#x20;   if bits(i) == 1

&#x20;       s(idx1) = 1;

&#x20;   else

&#x20;       s(idx1) = -1;

&#x20;   end

end

end



function \[t,s] = manchester(bits, bitrate)

Tb = 1/bitrate;

samples = 100;

t = 0:Tb/samples:Tb\*length(bits);

s = zeros(size(t));



for i = 1:length(bits)

&#x20;   idx1 = (t >= (i-1)\*Tb) \& (t < (i-0.5)\*Tb);

&#x20;   idx2 = (t >= (i-0.5)\*Tb) \& (t < i\*Tb);



&#x20;   if bits(i) == 1

&#x20;       s(idx1) = 1;

&#x20;       s(idx2) = -1;

&#x20;   else

&#x20;       s(idx1) = -1;

&#x20;       s(idx2) = 1;

&#x20;   end

end

end

