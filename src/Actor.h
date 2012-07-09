/*
 * File:   Actor.h
 * Author: Brian
 *
 * Created on June 17, 2012, 1:50 AM
 */

#ifndef ACTOR_H
#define	ACTOR_H


#include <libtcod/libtcod.hpp>
#include <string>

#include "Drawable.h"

class Actor: public Drawable 
{
    private:
        std::string name;

    public:
        Actor(int x, int y, int c);
        Actor(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Actor(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk);
        Actor(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, const std::string& name);
        ~Actor();

        void draw();
        void setName(const std::string& newname);
        const std::string getName() const;
};

#endif	/* ACTOR_H */

