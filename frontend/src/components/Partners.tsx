import { motion } from 'framer-motion';

const Partners = () => {
  const partners = [
    { name: 'MultiversX', icon: '◈' },
    { name: 'DAO Maker', icon: '▲' },
    { name: 'Chainlink', icon: '⬢' },
    { name: 'VENUS', icon: '▼' },
    { name: 'Ambisafe', icon: '◆' },
    { name: 'Blockforce', icon: '■' }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.2, duration: 1 }}
      className="w-full max-w-6xl mx-auto px-6 py-10"
    >
      <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-6 md:gap-x-16">
        {partners.map((partner) => (
          <div 
            key={partner.name} 
            className="flex items-center gap-2 grayscale opacity-20 hover:grayscale-0 hover:opacity-60 transition-all duration-500 cursor-pointer"
          >
            <span className="text-xl text-white">{partner.icon}</span>
            <span className="text-[11px] font-bold tracking-[0.2em] text-white">
              {partner.name.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default Partners;
