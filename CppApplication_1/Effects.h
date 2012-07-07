/* 
 * File:   Effects.h
 * Author: Exiiile
 *
 * Created on June 20, 2012, 1:53 PM
 */

#ifndef EFFECTS_H
#define	EFFECTS_H
#include "libtcod.hpp"
#include "Drawable.h"

class Effects : public Drawable {
public:
    Effects(int,int,int,TCODColor, TCODColor, bool, bool);
    Effects(int, TCODColor,TCODColor,bool ,bool );
    Effects(const Effects& orig);
    virtual ~Effects();
private:

};

#endif	/* EFFECTS_H */

