/* 
 * File:   Drawable.h
 * Author: Brian
 *
 * Created on June 16, 2012, 9:29 PM
 */

#ifndef DRAWABLE_H
#define	DRAWABLE_H

#include <libtcod/libtcod.hpp>

class Drawable {
    protected:
        int x;
        int y;
        int c;
        TCODColor fore;
        TCODColor back;
        bool trans;
        bool walk;

    public:
        Drawable(int x, int y, int c);
        Drawable(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Drawable(int x, int y, int c, TCODColor fore, TCODColor back,bool trans ,bool walk);
        virtual ~Drawable();

        void setX(int);
        void setY(int);

        // Movement
        bool moveRight();
        bool moveLeft();
        bool moveDown();
        bool moveUp();
        bool moveUpLeft();
        bool moveDownLeft();
        bool moveUpRight();
        bool moveDownRight();

        virtual void draw();

        // Getters
        int returnx();
        int returny();
        int returnz();
        TCODColor returnfore();
        TCODColor returnback();
        bool returnwalk();
        bool returntrans();

    private:
};

#endif	/* DRAWABLE_H */

